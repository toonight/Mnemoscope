import {
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
  type App,
  type FileSystemAdapter,
} from "obsidian";
import { computeRotScore, extractSignature, type RotScore } from "@mnemoscope/core";

interface MnemoscopeSettings {
  workingMaxAgeDays: number;
  episodicMaxAgeDays: number;
  autoScanOnOpen: boolean;
}

const DEFAULT_SETTINGS: MnemoscopeSettings = {
  workingMaxAgeDays: 7,
  episodicMaxAgeDays: 90,
  autoScanOnOpen: false,
};

const VIEW_TYPE_MNEMOSCOPE = "mnemoscope-view";

export default class MnemoscopePlugin extends Plugin {
  settings: MnemoscopeSettings = DEFAULT_SETTINGS;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_MNEMOSCOPE, (leaf) => new MnemoscopeView(leaf, this));

    this.addRibbonIcon("eye", "Mnemoscope: open rot scope", () => this.activateView());

    this.addCommand({
      id: "open-rot-scope",
      name: "Open rot scope",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "scan-vault-rot",
      name: "Scan vault rot (notice only)",
      callback: () => this.scanAndNotify(),
    });

    this.addSettingTab(new MnemoscopeSettingTab(this.app, this));

    if (this.settings.autoScanOnOpen) {
      this.app.workspace.onLayoutReady(() => void this.activateView());
    }
  }

  override onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MNEMOSCOPE);
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
    if (leaf) workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async scan(): Promise<RotScore | null> {
    const vaultPath = this.resolveVaultPath();
    if (!vaultPath) return null;
    const sig = await extractSignature(vaultPath);
    return computeRotScore(sig);
  }

  async scanAndNotify(): Promise<void> {
    const vaultPath = this.resolveVaultPath();
    if (!vaultPath) {
      new Notice("Mnemoscope: this vault is not on the local filesystem.");
      return;
    }
    new Notice("Mnemoscope: scanning…");
    try {
      const sig = await extractSignature(vaultPath);
      const result = computeRotScore(sig);
      new Notice(
        [
          `Mnemoscope rot risk: ${result.score}/100`,
          `Dominant factor: ${result.dominantFactor}`,
          `Notes: ${sig.noteCount} (~${sig.approxTokens.toLocaleString()} tokens)`,
        ].join("\n"),
        10_000,
      );
    } catch (err) {
      console.error("[mnemoscope] scan failed", err);
      new Notice(`Mnemoscope: scan failed (${(err as Error).message})`);
    }
  }

  resolveVaultPath(): string | null {
    const adapter = this.app.vault.adapter as FileSystemAdapter;
    return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null;
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

    const header = container.createEl("div", { cls: "mnemoscope-header" });
    header.createEl("h3", { text: "Mnemoscope" });
    const refreshBtn = header.createEl("button", { text: "Rescan" });
    refreshBtn.onclick = () => void this.refresh();

    const status = container.createEl("div", { cls: "mnemoscope-status" });
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
    for (const [name, value] of Object.entries(result.factors) as Array<[string, number]>) {
      const li = factorList.createEl("li");
      li.createEl("span", { text: name, cls: "mnemoscope-factor-name" });
      const bar = li.createDiv({ cls: "mnemoscope-bar" });
      const fill = bar.createDiv({ cls: "mnemoscope-bar-fill" });
      fill.style.width = `${Math.round(value)}%`;
      li.createEl("span", { text: `${Math.round(value)}`, cls: "mnemoscope-factor-value" });
    }

    container.createEl("h4", { text: "Top risk notes" });
    const list = container.createEl("ul", { cls: "mnemoscope-top-notes" });
    for (const note of result.topRiskNotes) {
      const li = list.createEl("li");
      li.createEl("span", { text: note.relPath, cls: "mnemoscope-note-path" });
      li.createEl("span", {
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
  }
}

function buildGaugeSvg(score: number): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 200 120");
  svg.setAttribute("width", "100%");
  svg.setAttribute("aria-label", `rot risk score ${score} of 100`);
  svg.setAttribute("role", "img");

  const trackPath = "M 20 100 A 80 80 0 0 1 180 100";
  const track = document.createElementNS(ns, "path");
  track.setAttribute("d", trackPath);
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", "rgba(95,217,209,0.18)");
  track.setAttribute("stroke-width", "12");
  track.setAttribute("stroke-linecap", "round");
  svg.appendChild(track);

  const fill = document.createElementNS(ns, "path");
  fill.setAttribute("d", trackPath);
  fill.setAttribute("fill", "none");
  fill.setAttribute("stroke", colorForScore(score));
  fill.setAttribute("stroke-width", "12");
  fill.setAttribute("stroke-linecap", "round");
  const totalLen = 251;
  const filledLen = (Math.max(0, Math.min(100, score)) / 100) * totalLen;
  fill.setAttribute("stroke-dasharray", `${filledLen} ${totalLen}`);
  svg.appendChild(fill);

  const text = document.createElementNS(ns, "text");
  text.setAttribute("x", "100");
  text.setAttribute("y", "92");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "40");
  text.setAttribute("font-weight", "700");
  text.setAttribute("fill", colorForScore(score));
  text.textContent = String(score);
  svg.appendChild(text);

  const label = document.createElementNS(ns, "text");
  label.setAttribute("x", "100");
  label.setAttribute("y", "112");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("font-size", "11");
  label.setAttribute("fill", "var(--text-muted)");
  label.textContent = "rot risk / 100";
  svg.appendChild(label);

  return svg;
}

function colorForScore(score: number): string {
  if (score < 30) return "#7cf09d";
  if (score < 60) return "#fbbf24";
  return "#f87171";
}
