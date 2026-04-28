# @mnemoscope/mcp-server

MCP server exposing [Mnemoscope](https://github.com/toonight/Mnemoscope)'s context-rot scoring, tiered reading, and signed journal tools to any [Model Context Protocol](https://modelcontextprotocol.io)–compatible client (Claude Code, Cursor, ChatGPT desktop, anything that speaks MCP over stdio).

100% local. No cloud. No telemetry. Apache-2.0.

## Install

```bash
npm install -g @mnemoscope/mcp-server
# the `mnemoscope-mcp` binary is now on your PATH
```

Or run via `npx` without a global install:

```bash
npx -y @mnemoscope/mcp-server
```

## Connect to Claude Code

```jsonc
// ~/.claude/settings.json
{
  "mcpServers": {
    "mnemoscope": {
      "command": "npx",
      "args": ["-y", "@mnemoscope/mcp-server"]
    }
  }
}
```

Restart Claude Code. The four tools below are discovered automatically.

## Tools

| Tool | Input | What it returns |
|---|---|---|
| `predict_rot` | `vault_path` | 0–100 risk score, dominant factor, full factor breakdown, top-5 risk notes, vault stats |
| `get_tiered_read` | `vault_path`, optional `working_max_age_days`, `episodic_max_age_days` | Working / episodic / semantic split of the vault by freshness |
| `record_journal` | `vault_path`, `session_id`, `op` (`read`/`write`/`create`/`delete`), `target_path`, optional content | The signed entry, including its `sig`, `keyFingerprint`, and `prevHash` |
| `read_journal` | `vault_path`, optional `session_id` | All journal entries, or a single session's |

### Example — `predict_rot`

```json
{
  "rot_risk": 41,
  "dominant_factor": "tokenVolume",
  "factors": {
    "tokenVolume": 100, "semanticRedundancy": 0,
    "distractorDensity": 2.65, "structuralCoherence": 100, "freshnessSpread": 0
  },
  "top_risk_notes": [
    { "relPath": "brainstorms/.../transcript.md", "approxTokens": 13439, "reason": "very large note" }
  ],
  "vault_stats": { "noteCount": 113, "approxTokens": 506823 },
  "baseline_model": "v0-heuristic",
  "version": "0.1.0"
}
```

## Bootstrap a vault

Before the journal tools work the vault needs an Ed25519 keypair. The companion [`@mnemoscope/cli`](https://www.npmjs.com/package/@mnemoscope/cli) ships `mnemoscope-init` for that:

```bash
npx -p @mnemoscope/cli mnemoscope-init /path/to/your/vault
```

The auto-onboarding modal in the [Obsidian plugin](https://github.com/toonight/Mnemoscope/tree/main/packages/obsidian-plugin) does the same on first launch.

## Verify the journal

```bash
npx -p @mnemoscope/cli mnemoscope-verify /path/to/your/vault
```

Exits non-zero on field tampering, hash-chain break, or entries signed by a key the current vault does not own.

## What this server does NOT do

- It does not store or transmit your vault content. All reads are local; all writes are local.
- It does not call any external service. (The optional `mnemoscope-timestamp` CLI in `@mnemoscope/cli` POSTs *only* a SHA-256 digest of each journal entry's signature to a public OpenTimestamps calendar — never any vault content.)
- It does not replace a memory store. It is an *instrument* for one — see the README for the comparison with Letta, Mem0, Zep, Cognee, MemPalace, and Smart Connections.

## Repo + docs

- Source, issues, releases: https://github.com/toonight/Mnemoscope
- Architecture, threat model, scientific posture: see the [main README](https://github.com/toonight/Mnemoscope#readme)

## License

[Apache-2.0](https://github.com/toonight/Mnemoscope/blob/main/LICENSE).
