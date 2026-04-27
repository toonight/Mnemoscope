# Wiring the auto-journal hook into Claude Code

Mnemoscope ships a `mnemoscope-record-hook` binary (in `@mnemoscope/cli`) that you can register as a Claude Code `PostToolUse` hook. Once wired, every `Write` / `Edit` / `MultiEdit` performed by Claude Code on your vault is automatically recorded — signed with your per-vault Ed25519 key — into `.mnemoscope/journal.jsonl`.

## Install

```bash
cd /path/to/Mnemoscope
npm install
npm run build
npm link --workspace @mnemoscope/cli
# `mnemoscope-record-hook` and `mnemoscope-verify` are now on your PATH.
```

## Register the hook

Add this to **either** `~/.claude/settings.json` (global) or `<vault>/.claude/settings.json` (per-vault):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "mnemoscope-record-hook" }
        ]
      }
    ]
  }
}
```

## Configuration

The hook resolves the **vault root** in this order:

1. `MNEMOSCOPE_VAULT_PATH` environment variable, if set.
2. Otherwise, it walks up from the file path Claude Code just wrote, looking for a `.mnemoscope/` directory. The first ancestor that contains one is the vault root.
3. Otherwise, the hook exits silently — nothing is journalled.

To enable journaling for a vault that does not yet have the directory, run once:

```bash
mkdir /path/to/vault/.mnemoscope
```

Optional environment variables:

| Variable | Purpose |
|---|---|
| `MNEMOSCOPE_VAULT_PATH` | Force the vault root, ignoring the walk-up search. |
| `MNEMOSCOPE_HOOK_VERBOSE` | When set to `1`, the hook logs each recorded op to stderr (visible in Claude Code's hook logs). |

## Verifying the journal

At any time:

```bash
mnemoscope-verify /path/to/vault
```

Exits `0` if every signature is valid, `1` if any entry has been tampered with or was signed by a different key.

## Safety properties

- **The hook never blocks the tool call.** Any internal error (missing payload field, unreadable file, etc.) is logged to stderr and the process exits `0`.
- **The hook only reads, never writes to the vault** beyond appending to `.mnemoscope/journal.jsonl` and creating the keypair on first use.
- **The Ed25519 private key is stored at `<vault>/.mnemoscope/keys/ed25519.key` with mode `0600`.** Treat the file as you would any other private key — back it up, do not commit it.
- **Per-entry signatures detect tampering with any field of any entry.** They do **not** detect entry deletion (truncation). A future version will chain entries to make truncation detectable.
