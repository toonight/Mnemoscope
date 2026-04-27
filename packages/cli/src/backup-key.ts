#!/usr/bin/env node
/**
 * `mnemoscope-backup-key <vault-path> <output-path> [--comment "..."]`
 *
 * Encrypts <vault-path>/.mnemoscope/keys/ed25519.key with a passphrase
 * read from stdin (or the MNEMOSCOPE_PASSPHRASE env var) and writes a
 * self-describing JSON envelope to <output-path>. The output file is
 * chmod 0600. Uses scrypt (N=32768, r=8, p=1) + AES-256-GCM, no
 * external dependencies.
 *
 * The original private key is left in place — this is a backup, not
 * a move. Lose the passphrase and the backup is unrecoverable.
 */
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { backupPrivateKey } from "@mnemoscope/core";
import { readPassphrase, parseFlags } from "./lib/passphrase.js";

void main();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const flags = parseFlags(args, ["comment"]);
  if (positional.length < 2) {
    process.stderr.write("usage: mnemoscope-backup-key <vault-path> <output-path> [--comment \"...\"]\n");
    process.exit(1);
  }
  const vaultPath = resolve(positional[0]!);
  const outputPath = resolve(positional[1]!);
  const keyPath = join(vaultPath, ".mnemoscope", "keys", "ed25519.key");
  if (!existsSync(keyPath)) {
    process.stderr.write(`No private key at ${keyPath}. Run mnemoscope-init first.\n`);
    process.exit(1);
  }

  const passphrase = await readPassphrase("Passphrase to encrypt the backup (≥8 chars): ", { confirm: true });

  await backupPrivateKey(keyPath, outputPath, passphrase, flags["comment"]);
  process.stdout.write(
    [
      `Wrote encrypted backup of ${keyPath}`,
      `              to: ${outputPath}`,
      "  algorithm: AES-256-GCM, scrypt (N=32768, r=8, p=1)",
      "  permissions: 0600",
      "",
      "Store this file somewhere off the vault. If you lose the passphrase, the backup is unrecoverable.",
      "",
    ].join("\n"),
  );
}
