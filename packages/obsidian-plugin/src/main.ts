import {
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  type App,
  type FileSystemAdapter,
  type WorkspaceLeaf,
} from "obsidian";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Journal, computeRotScore, extractSignature, type RotScore } from "@mnemoscope/core";

interface MnemoscopeSettings {
  workingMaxAgeDays: number;
  episodicMaxAgeDays: number;
  autoScanOnOpen: boolean;
  onboardingDismissed: boolean;
}

const DEFAULT_SETTINGS: MnemoscopeSettings = {
  workingMaxAgeDays: 7,
  episodicMaxAgeDays: 90,
  autoScanOnOpen: false,
  onboardingDismissed: false,
};

const MNEMOSCOPE_DIR = ".mnemoscope";
const ONBOARDING_README = `# .mnemoscope/

This directory is created and managed by Mnemoscope, an open-source
observability layer for LLM agent memory on Markdown vaults.

  https://github.com/toonight/Mnemoscope

Contents:

  keys/ed25519.key   — per-vault Ed25519 PRIVATE KEY (mode 0600).
                       Treat as a secret. Back up. Do not commit.
  keys/ed25519.pub   — public half, safe to share.
  journal.jsonl      — append-only signed journal of agent operations.

If you want to disable Mnemoscope for this vault, simply remove this
directory. The Mnemoscope MCP server, Obsidian plugin, and Claude Code
hook all detect its absence and exit cleanly.
`;

const VIEW_TYPE_MNEMOSCOPE = "mnemoscope-view";

export default class MnemoscopePlugin extends Plugin {
  settings: MnemoscopeSettings = DEFAULT_SETTINGS;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_MNEMOSCOPE, (leaf) => new MnemoscopeView(leaf, this));

    this.addRibbonIcon("eye", "Open rot scope", () => void this.activateView());

    this.addCommand({
      id: "open-rot-scope",
      name: "Open rot scope",
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "scan-vault-rot",
      name: "Scan vault rot",
      callback: () => void this.scanAndNotify(),
    });

    this.addCommand({
      id: "initialize-vault",
      name: "Initialize vault",
      callback: () => void this.initializeVault({ silent: false }),
    });

    this.addSettingTab(new MnemoscopeSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoScanOnOpen) void this.activateView();
      this.maybeOfferOnboarding();
    });
  }

  // Per Obsidian guidelines, leaves are NOT detached in onunload — Obsidian
  // restores their position itself, and detaching here would reset the
  // user's chosen layout next time the plugin loads.
  override onunload(): void {
    // intentionally empty
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_MNEMOSCOPE);
    if (existing.length > 0) {
      leaf = existing[0]!;
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: VIEW_TYPE_MNEMOSCOPE, active: true });
    }
    if (leaf) await workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<MnemoscopeSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Walk the vault, skipping Obsidian's actual configuration folder (which
   * the user can rename via `Vault#configDir`) plus the usual non-content
   * directories. Then run the v0 rot heuristic.
   */
  private signatureOptions(): { ignoredDirs: readonly string[] } {
    const configDir = this.app.vault.configDir;
    return { ignoredDirs: [configDir, ".git", "node_modules", ".trash"] };
  }

  async scan(): Promise<RotScore | null> {
    const vaultPath = this.resolveVaultPath();
    if (!vaultPath) return null;
    const sig = await extractSignature(vaultPath, this.signatureOptions());
    return computeRotScore(sig);
  }

  async scanAndNotify(): Promise<void> {
    const vaultPath = this.resolveVaultPath();
    if (!vaultPath) {
      new Notice("This vault is not on the local filesystem.");
      return;
    }
    new Notice("Scanning vault…");
    try {
      const sig = await extractSignature(vaultPath, this.signatureOptions());
      const result = computeRotScore(sig);
      new Notice(
        [
          `Rot risk: ${String(result.score)}/100`,
          `Dominant factor: ${result.dominantFactor}`,
          `Notes: ${String(sig.noteCount)} (~${sig.approxTokens.toLocaleString()} tokens)`,
        ].join("\n"),
        10_000,
      );
    } catch (err) {
      console.error("[mnemoscope] scan failed", err);
      new Notice(`Scan failed (${(err as Error).message})`);
    }
  }

  resolveVaultPath(): string | null {
    const adapter = this.app.vault.adapter as FileSystemAdapter;
    return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null;
  }

  isInitialized(): boolean {
    const vaultPath = this.resolveVaultPath();
    if (!vaultPath) return false;
    return existsSync(join(vaultPath, MNEMOSCOPE_DIR));
  }

  /**
   * On layout-ready, if the vault has no `.mnemoscope/` and the user
   * has not previously dismissed the prompt, surface a one-time modal
   * that explains what initialization will do and lets them opt in.
   * Initialization itself is identical to `mnemoscope-init`: mkdir
   * `.mnemoscope/`, generate a per-vault Ed25519 keypair via
   * `Journal.open`, and write a small README.
   */
  maybeOfferOnboarding(): void {
    if (this.settings.onboardingDismissed) return;
    if (this.isInitialized()) return;
    const vaultPath = this.resolveVaultPath();
    if (!vaultPath) return;

    new OnboardingModal(this.app, {
      vaultPath,
      onAccept: () => void this.initializeVault({ silent: false }),
      onDismiss: () => {
        this.settings.onboardingDismissed = true;
        void this.saveSettings();
      },
    }).open();
  }

  async initializeVault(opts: { silent: boolean }): Promise<void> {
    const vaultPath = this.resolveVaultPath();
    if (!vaultPath) {
      if (!opts.silent) new Notice("Mnemoscope: this vault is not on the local filesystem.");
      return;
    }
    const mnemoscopeDir = join(vaultPath, MNEMOSCOPE_DIR);
    const journalPath = join(mnemoscopeDir, "journal.jsonl");
    const readmePath = join(mnemoscopeDir, "README.txt");

    try {
      await mkdir(mnemoscopeDir, { recursive: true });
      const journal = await Journal.open(journalPath, "obsidian-plugin");
      const fingerprint = journal.publicKeyFingerprint();
      if (!existsSync(readmePath)) {
        await writeFile(readmePath, ONBOARDING_README, "utf8");
      }
      this.settings.onboardingDismissed = true;
      await this.saveSettings();
      new Notice(`Initialized. Public key fingerprint: ${fingerprint}`, 8_000);
    } catch (err) {
      console.error("[mnemoscope] initialize failed", err);
      new Notice(`Initialize failed (${(err as Error).message})`);
    }
  }
}

interface OnboardingModalOpts {
  vaultPath: string;
  onAccept: () => void;
  onDismiss: () => void;
}

class OnboardingModal extends Modal {
  constructor(app: App, private readonly opts: OnboardingModalOpts) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Set up vault for journaling" });

    contentEl.createEl("p", {
      text: "This plugin keeps an observability layer for LLM agent memory. "
        + "Initializing creates a small private directory inside this vault:",
    });

    const list = contentEl.createEl("ul");
    list.createEl("li", { text: `${this.opts.vaultPath}/.mnemoscope/` });
    list.createEl("li", { text: "keys/ed25519.key — per-vault private key, mode 0600" });
    list.createEl("li", { text: "keys/ed25519.pub — public half" });
    list.createEl("li", { text: "Journal.jsonl — signed append-only journal" });
    list.createEl("li", { text: "Readme — describes the directory" });

    contentEl.createEl("p", {
      text: "Nothing leaves your machine. You can disable journaling for this vault "
        + "at any time by deleting that directory.",
    });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const initBtn = buttons.createEl("button", { text: "Initialize" });
    initBtn.addClass("mod-cta");
    initBtn.onclick = () => {
      this.opts.onAccept();
      this.close();
    };
    const dismissBtn = buttons.createEl("button", { text: "Not now" });
    dismissBtn.onclick = () => {
      this.opts.onDismiss();
      this.close();
    };
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

class MnemoscopeView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly plugin: MnemoscopePlugin) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_MNEMOSCOPE;
  }

  override getDisplayText(): string {
    return "Mnemoscope rot scope";
  }

  override getIcon(): string {
    return "eye";
  }

  override async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("mnemoscope-view");

    const header = container.createDiv({ cls: "mnemoscope-header" });
    header.createEl("h3", { text: "Mnemoscope" });
    const refreshBtn = header.createEl("button", { text: "Rescan" });
    refreshBtn.onclick = () => void this.refresh();

    const status = container.createDiv({ cls: "mnemoscope-status" });
    status.setText("Scanning vault…");

    let result: RotScore | null;
    try {
      result = await this.plugin.scan();
    } catch (err) {
      status.setText(`Scan failed: ${(err as Error).message}`);
      return;
    }
    if (!result) {
      status.setText("This vault is not on the local filesystem; nothing to scan.");
      return;
    }
    status.setText("");

    const gauge = container.createDiv({ cls: "mnemoscope-gauge" });
    gauge.appendChild(buildGaugeSvg(result.score));

    const summary = container.createDiv({ cls: "mnemoscope-summary" });
    summary.createEl("p", { text: `Dominant factor: ${result.dominantFactor}` });
    summary.createEl("p", { text: `Baseline: ${result.baselineModel}` });

    container.createEl("h4", { text: "Factor breakdown" });
    const factorList = container.createEl("ul", { cls: "mnemoscope-factors" });
    for (const [name, value] of Object.entries(result.factors)) {
      const li = factorList.createEl("li");
      li.createSpan({ text: name, cls: "mnemoscope-factor-name" });
      const bar = li.createDiv({ cls: "mnemoscope-bar" });
      const fill = bar.createDiv({ cls: "mnemoscope-bar-fill" });
      fill.style.width = `${String(Math.round(value))}%`;
      li.createSpan({ text: `${String(Math.round(value))}`, cls: "mnemoscope-factor-value" });
    }

    container.createEl("h4", { text: "Top risk notes" });
    const list = container.createEl("ul", { cls: "mnemoscope-top-notes" });
    for (const note of result.topRiskNotes) {
      const li = list.createEl("li");
      li.createSpan({ text: note.relPath, cls: "mnemoscope-note-path" });
      li.createSpan({
        text: ` · ${note.approxTokens.toLocaleString()} tok · ${note.reason}`,
        cls: "mnemoscope-note-meta",
      });
    }
  }
}

class MnemoscopeSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MnemoscopePlugin) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Working layer max age")
      .setDesc("Notes modified within this many days go in the working layer.")
      .addSlider((s) =>
        s
          .setLimits(1, 30, 1)
          .setValue(this.plugin.settings.workingMaxAgeDays)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.workingMaxAgeDays = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Episodic layer max age")
      .setDesc("Notes modified within this many days go in the episodic layer.")
      .addSlider((s) =>
        s
          .setLimits(7, 365, 1)
          .setValue(this.plugin.settings.episodicMaxAgeDays)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.episodicMaxAgeDays = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Auto-scan on Obsidian open")
      .setDesc("Open the rot scope view automatically when Obsidian starts.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoScanOnOpen).onChange(async (v) => {
          this.plugin.settings.autoScanOnOpen = v;
          await this.plugin.saveSettings();
        }),
      );

    const initialized = this.plugin.isInitialized();
    new Setting(containerEl)
      .setName(initialized ? "Vault is initialized" : "Initialize vault")
      .setDesc(
        initialized
          ? "This vault has a .mnemoscope/ directory and a per-vault keypair."
          : "Create .mnemoscope/, generate a per-vault Ed25519 keypair, and start signing the journal.",
      )
      .addButton((b) =>
        b
          .setButtonText(initialized ? "Re-check" : "Initialize")
          .setCta()
          .onClick(async () => {
            if (initialized) {
              new Notice("This vault is already initialized.");
            } else {
              await this.plugin.initializeVault({ silent: false });
            }
            this.display();
          }),
      );
  }
}

function buildGaugeSvg(score: number): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = activeDocument.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 200 120");
  svg.setAttribute("width", "100%");
  svg.setAttribute("aria-label", `rot risk score ${score} of 100`);
  svg.setAttribute("role", "img");

  const trackPath = "M 20 100 A 80 80 0 0 1 180 100";
  const track = activeDocument.createElementNS(ns, "path");
  track.setAttribute("d", trackPath);
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", "rgba(95,217,209,0.18)");
  track.setAttribute("stroke-width", "12");
  track.setAttribute("stroke-linecap", "round");
  svg.appendChild(track);

  const fill = activeDocument.createElementNS(ns, "path");
  fill.setAttribute("d", trackPath);
  fill.setAttribute("fill", "none");
  fill.setAttribute("stroke", colorForScore(score));
  fill.setAttribute("stroke-width", "12");
  fill.setAttribute("stroke-linecap", "round");
  const totalLen = 251;
  const filledLen = (Math.max(0, Math.min(100, score)) / 100) * totalLen;
  fill.setAttribute("stroke-dasharray", `${filledLen} ${totalLen}`);
  svg.appendChild(fill);

  const text = activeDocument.createElementNS(ns, "text");
  text.setAttribute("x", "100");
  text.setAttribute("y", "92");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "40");
  text.setAttribute("font-weight", "700");
  text.setAttribute("fill", colorForScore(score));
  text.textContent = String(score);
  svg.appendChild(text);

  const label = activeDocument.createElementNS(ns, "text");
  label.setAttribute("x", "100");
  label.setAttribute("y", "112");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("font-size", "11");
  label.setAttribute("fill", "var(--text-muted)");
  label.textContent = "Rot risk out of 100";
  svg.appendChild(label);

  return svg;
}

function colorForScore(score: number): string {
  if (score < 30) return "#7cf09d";
  if (score < 60) return "#fbbf24";
  return "#f87171";
}
