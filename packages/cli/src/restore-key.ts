#!/usr/bin/env node
/**
 * `mnemoscope-restore-key <vault-path> <backup-path> [--overwrite]`
 *
 * Decrypts a backup produced by `mnemoscope-backup-key` with a
 * passphrase read from stdin (or MNEMOSCOPE_PASSPHRASE) and writes
 * the PEM into <vault-path>/.mnemoscope/keys/ed25519.key with mode
 * 0600. By default refuses to overwrite an existing key — pass
 * `--overwrite` to force.
 */
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { restorePrivateKey } from "@mnemoscope/core";
import { readPassphrase, parseFlags } from "./lib/passphrase.js";

void main();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const flags = parseFlags(args, ["overwrite"]);
  if (positional.length < 2) {
    process.stderr.write("usage: mnemoscope-restore-key <vault-path> <backup-path> [--overwrite]\n");
    process.exit(1);
  }
  const vaultPath = resolve(positional[0]!);
  const backupPath = resolve(positional[1]!);
  if (!existsSync(backupPath)) {
    process.stderr.write(`No backup at ${backupPath}\n`);
    process.exit(1);
  }
  const keyDir = join(vaultPath, ".mnemoscope", "keys");
  await mkdir(keyDir, { recursive: true });
  const keyPath = join(keyDir, "ed25519.key");

  const passphrase = await readPassphrase("Passphrase: ", { confirm: false });

  try {
    await restorePrivateKey(backupPath, keyPath, passphrase, { overwrite: flags["overwrite"] !== undefined });
  } catch (err) {
    process.stderr.write(`mnemoscope-restore-key: ${(err as Error).message}\n`);
    process.exit(1);
  }
  process.stdout.write(
    [
      `Restored private key into ${keyPath}`,
      "  permissions: 0600",
      "",
      "Run mnemoscope-verify to confirm the journal still verifies against this key.",
      "",
    ].join("\n"),
  );
}
