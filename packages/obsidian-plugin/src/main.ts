import { Notice, Plugin, type FileSystemAdapter } from "obsidian";
import { computeRotScore, extractSignature } from "@mnemoscope/core";

export default class MnemoscopePlugin extends Plugin {
  override async onload(): Promise<void> {
    this.addRibbonIcon("eye", "Mnemoscope: scan vault rot", () => this.scanCommand());
    this.addCommand({
      id: "scan-vault-rot",
      name: "Scan vault rot",
      callback: () => this.scanCommand(),
    });
  }

  private async scanCommand(): Promise<void> {
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
      console.info("[mnemoscope] result", result);
    } catch (err) {
      console.error("[mnemoscope] scan failed", err);
      new Notice(`Mnemoscope: scan failed (${(err as Error).message})`);
    }
  }

  private resolveVaultPath(): string | null {
    const adapter = this.app.vault.adapter as FileSystemAdapter;
    return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null;
  }
}
