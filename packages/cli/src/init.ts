#!/usr/bin/env node
/**
 * `mnemoscope init [vault-path]`
 *
 * Bootstraps a vault for Mnemoscope:
 *   1. Creates `<vault>/.mnemoscope/` and `<vault>/.mnemoscope/keys/`.
 *   2. Generates a fresh per-vault Ed25519 keypair (mode 0600 on the
 *      private key) by opening the journal — no entries are written.
 *   3. Writes a tiny README to the .mnemoscope/ directory pointing at
 *      the project so a curious vault owner knows what the directory is.
 *
 * Idempotent: re-running on a vault that already has a keypair leaves it
 * untouched and exits 0.
 */
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { writeFile, mkdir, stat } from "node:fs/promises";
import { Journal } from "@mnemoscope/core";

const README_TEXT = `# .mnemoscope/

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

void main();

async function main(): Promise<void> {
  const vaultArg = process.argv[2] ?? process.cwd();
  const vaultPath = resolve(vaultArg);

  try {
    const st = await stat(vaultPath);
    if (!st.isDirectory()) {
      process.stderr.write(`mnemoscope init: ${vaultPath} is not a directory\n`);
      process.exit(1);
    }
  } catch {
    process.stderr.write(`mnemoscope init: ${vaultPath} does not exist\n`);
    process.exit(1);
  }

  const mnemoscopeDir = join(vaultPath, ".mnemoscope");
  const journalPath = join(mnemoscopeDir, "journal.jsonl");
  const readmePath = join(mnemoscopeDir, "README.txt");

  await mkdir(mnemoscopeDir, { recursive: true });

  // Open the journal: this creates the keypair on first run; no-op afterwards.
  const journal = await Journal.open(journalPath, "init");
  const fingerprint = journal.publicKeyFingerprint();
  const alreadyInitialized = existsSync(readmePath);

  if (!alreadyInitialized) {
    await writeFile(readmePath, README_TEXT, "utf8");
  }

  process.stdout.write(
    [
      alreadyInitialized
        ? `Mnemoscope already initialized in ${vaultPath}.`
        : `Initialized Mnemoscope in ${vaultPath}.`,
      `  vault root:  ${vaultPath}`,
      `  state dir:   ${mnemoscopeDir}`,
      `  journal:     ${journalPath}`,
      `  public key:  ${join(mnemoscopeDir, "keys", "ed25519.pub")}`,
      `  fingerprint: ${fingerprint}`,
      "",
      "Next steps:",
      "  1. Add the MCP server to your client (see README).",
      "  2. (Optional) Wire the auto-journal hook in ~/.claude/settings.json:",
      "     PostToolUse matcher 'Write|Edit|MultiEdit' → command 'mnemoscope-record-hook'",
      "  3. Use 'mnemoscope-verify' to check the journal at any time.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}
