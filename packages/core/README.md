# @mnemoscope/core

Core memory observability primitives for [Mnemoscope](https://github.com/toonight/Mnemoscope) — predictive context-rot scoring, working/episodic/semantic tiering, and an append-only Ed25519-signed hash-chained journal of agent operations on a Markdown vault. 100% local, no runtime dependencies, Node ≥ 22.

This package is the engine the MCP server, the CLI binaries, and the Obsidian plugin all sit on top of. Use it directly if you are integrating Mnemoscope into a custom client.

## Install

```bash
npm install @mnemoscope/core
```

## Usage

### Score a vault before injection

```ts
import { extractSignature, computeRotScore } from "@mnemoscope/core";

const sig = await extractSignature("/path/to/vault");
const result = computeRotScore(sig);

console.log(result.score);            // 0..100
console.log(result.dominantFactor);   // e.g. "tokenVolume"
console.log(result.factors);          // 5-factor breakdown
console.log(result.topRiskNotes);     // top 5 highest-risk notes
```

### Tier a vault for compacted context

```ts
import { extractSignature, tierVault } from "@mnemoscope/core";

const sig = await extractSignature("/path/to/vault");
const tiers = tierVault(sig, { workingMaxAgeDays: 7, episodicMaxAgeDays: 90 });

// tiers.working   — fresh, inject in full
// tiers.episodic  — older but still relevant, inject summary
// tiers.semantic  — index only, retrieve on demand
```

### Append signed journal entries

```ts
import { Journal } from "@mnemoscope/core";

const journal = await Journal.open("/path/to/vault/.mnemoscope/journal.jsonl", "session-id");

await journal.record("write", "/path/to/vault/notes/foo.md", undefined, "new content");

const verified = await journal.verifyAll();
//   { entry: …, valid: true } | { entry: …, valid: false, reason: "signature mismatch" | "chain break: …" | "signed by unknown key …" }
```

The journal opens (or creates) a per-vault Ed25519 keypair at `<vault>/.mnemoscope/keys/ed25519.{key,pub}` with the private key chmoded `0600`. Each entry's `prevHash` is the SHA-256 of the previous entry's signature, so field tampering, deletion, and reordering are all detectable.

### Encrypted off-vault key escrow

```ts
import { backupPrivateKey, restorePrivateKey } from "@mnemoscope/core";

await backupPrivateKey("/vault/.mnemoscope/keys/ed25519.key", "/safe/backup.enc.json", passphrase);
await restorePrivateKey("/safe/backup.enc.json", "/vault/.mnemoscope/keys/ed25519.key", passphrase);
```

scrypt (N=2¹⁵, r=8, p=1) + AES-256-GCM, self-describing JSON envelope, no external dependencies. Lose the passphrase and the backup is unrecoverable. Full threat model in [docs/key-escrow.md](https://github.com/toonight/Mnemoscope/blob/main/docs/key-escrow.md).

### OpenTimestamps anchoring

```ts
import { digestForEntrySig, requestCalendarTimestamp, composeOtsFile } from "@mnemoscope/core";

const digest = digestForEntrySig(entry.sig);
const body   = await requestCalendarTimestamp({ digest, calendarUrl: "https://alice.btc.calendar.opentimestamps.org" });
const ots    = composeOtsFile(digest, body);
// write `ots` to <vault>/.mnemoscope/timestamps/<sigHashHex>.ots
```

Pending proofs become Bitcoin-anchored once the calendar's commitment lands in a block (~1 hour). Upgrade and verify with the upstream [`opentimestamps-client`](https://github.com/opentimestamps/opentimestamps-client). Full flow in [docs/timestamping.md](https://github.com/toonight/Mnemoscope/blob/main/docs/timestamping.md).

## Exported API

| Export | Purpose |
|---|---|
| `extractSignature(rootPath)` | Walk a Markdown vault, return its 5-factor structural signature |
| `computeRotScore(sig)` | Predictive context-rot risk score (v0 heuristic baseline) |
| `tokenVolumeFactor`, `semanticRedundancyFactor`, … | Individual factor functions, each citation-backed in source |
| `tierVault(sig, opts)` | Working / episodic / semantic split |
| `Journal` | Append-only Ed25519-signed, hash-chained journal |
| `backupPrivateKey`, `restorePrivateKey` | Encrypted off-vault key escrow |
| `digestForEntrySig`, `requestCalendarTimestamp`, `composeOtsFile`, `parseOtsFile`, `verifyOtsHeaderForDigest` | OpenTimestamps anchoring of journal entries |

See the [package source](https://github.com/toonight/Mnemoscope/tree/main/packages/core/src) for the full type declarations and per-function citations.

## License

[Apache-2.0](https://github.com/toonight/Mnemoscope/blob/main/LICENSE) — explicit patent grant.
