#!/usr/bin/env node
/**
 * `mnemoscope-timestamp <vault-path> [--calendar URL] [--dry-run]`
 *
 * Walk the vault's signed journal and request an OpenTimestamps proof
 * for every entry that does not yet have one. Each entry is anchored
 * by SHA-256(signature) — this binds the anchor to the *signing event*,
 * not to a re-canonicalized payload. Proofs land at:
 *
 *   <vault>/.mnemoscope/timestamps/<sigHashHex>.ots
 *
 * Idempotent: re-running on a vault that has up-to-date proofs makes
 * zero network requests and exits 0. Use the upstream `ots upgrade` /
 * `ots verify` CLIs to upgrade pending proofs to Bitcoin-anchored ones
 * and to verify them on chain.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  Journal,
  composeOtsFile,
  digestForEntrySig,
  requestCalendarTimestamp,
} from "@mnemoscope/core";
import { parseFlags } from "./lib/passphrase.js";

const DEFAULT_CALENDAR = "https://alice.btc.calendar.opentimestamps.org";

void main();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const flags = parseFlags(args, ["calendar", "dry-run"]);

  const vaultArg = positional[0];
  if (!vaultArg) {
    process.stderr.write("usage: mnemoscope-timestamp <vault-path> [--calendar URL] [--dry-run]\n");
    process.exit(1);
  }

  const vaultPath = resolve(vaultArg);
  const journalPath = join(vaultPath, ".mnemoscope", "journal.jsonl");
  const proofsDir = join(vaultPath, ".mnemoscope", "timestamps");
  const dryRun = flags["dry-run"] !== undefined;
  const calendar = flags["calendar"] || DEFAULT_CALENDAR;

  if (!existsSync(journalPath)) {
    process.stderr.write(`mnemoscope-timestamp: no journal at ${journalPath}\n`);
    process.exit(1);
  }

  await mkdir(proofsDir, { recursive: true });
  const journal = await Journal.open(journalPath, "timestamp-cli");
  const entries = await journal.readAll();

  let needed = 0;
  let stamped = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of entries) {
    const digest = digestForEntrySig(entry.sig);
    const sigHashHex = Buffer.from(digest).toString("hex");
    const proofPath = join(proofsDir, `${sigHashHex}.ots`);
    if (existsSync(proofPath)) {
      skipped++;
      continue;
    }
    needed++;
    if (dryRun) continue;

    try {
      const body = await requestCalendarTimestamp({ digest, calendarUrl: calendar });
      const ots = composeOtsFile(digest, body);
      await writeFile(proofPath, ots);
      stamped++;
      process.stdout.write(`  stamped ${shortHex(sigHashHex)} via ${calendar}\n`);
    } catch (err) {
      failed++;
      process.stderr.write(`  failed  ${shortHex(sigHashHex)}: ${(err as Error).message}\n`);
    }
  }

  process.stdout.write(
    [
      "",
      `Mnemoscope timestamp pass on ${vaultPath}`,
      `  total entries:    ${entries.length}`,
      `  already proved:   ${skipped}`,
      `  needed proof:     ${needed}`,
      ...(dryRun
        ? ["  mode:             dry-run (no calendar requests issued)"]
        : [
            `  newly stamped:    ${stamped}`,
            `  failed:           ${failed}`,
            `  calendar:         ${calendar}`,
          ]),
      "",
      "Next: run `ots upgrade <proof.ots>` and `ots verify <file>` once",
      "the calendar's pending commitment is included in a Bitcoin block",
      "(usually within an hour) to obtain a fully-self-contained proof.",
      "",
    ].join("\n"),
  );

  process.exit(failed > 0 && stamped === 0 ? 1 : 0);
}

function shortHex(hex: string): string {
  return `${hex.slice(0, 12)}…`;
}
