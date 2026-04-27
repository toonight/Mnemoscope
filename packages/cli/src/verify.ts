#!/usr/bin/env node
/**
 * `mnemoscope-verify [vault-path]`
 *
 * Verifies every entry in the local Mnemoscope journal of the given vault.
 * Exits 0 if every entry verifies, 1 if any entry fails.
 *
 * Defaults vault-path to the current working directory.
 */
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { Journal } from "@mnemoscope/core";

void main();

async function main(): Promise<void> {
  const vaultArg = process.argv[2] ?? process.cwd();
  const vaultPath = resolve(vaultArg);
  const journalPath = join(vaultPath, ".mnemoscope", "journal.jsonl");
  if (!existsSync(journalPath)) {
    process.stderr.write(`No journal at ${journalPath}\n`);
    process.exit(1);
  }
  const journal = await Journal.open(journalPath, "verify");
  const verified = await journal.verifyAll();
  let invalid = 0;
  for (const v of verified) {
    if (v.valid) {
      process.stdout.write(`ok    ${v.entry.ts}  ${v.entry.op.padEnd(6)} ${v.entry.path}\n`);
    } else {
      invalid += 1;
      process.stdout.write(`FAIL  ${v.entry.ts}  ${v.entry.op.padEnd(6)} ${v.entry.path}  (${v.reason})\n`);
    }
  }
  process.stdout.write(`\n${verified.length} entries; ${verified.length - invalid} valid; ${invalid} invalid\n`);
  process.exit(invalid === 0 ? 0 : 1);
}
