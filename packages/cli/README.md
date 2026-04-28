# @mnemoscope/cli

Command-line entrypoints for [Mnemoscope](https://github.com/toonight/Mnemoscope). Install once, get six binaries that bootstrap a vault, journal every agent write, verify the journal cryptographically, encrypt-and-restore the per-vault key off-vault, and anchor each entry to a Bitcoin-backed OpenTimestamps proof.

100% local. No cloud. Apache-2.0.

## Install

```bash
npm install -g @mnemoscope/cli
```

The following binaries land on your `PATH`:

| Binary | Purpose |
|---|---|
| `mnemoscope-init` | Bootstrap a vault (`<vault>/.mnemoscope/` + per-vault Ed25519 keypair, mode 0600) |
| `mnemoscope-record-hook` | Claude Code `PostToolUse` hook that auto-journals every Write/Edit/MultiEdit |
| `mnemoscope-verify` | Replay the journal and exit non-zero on any tampered / out-of-chain / foreign-key entry |
| `mnemoscope-backup-key` | Encrypt the per-vault private key with a passphrase (scrypt + AES-256-GCM) and write a JSON envelope off-vault |
| `mnemoscope-restore-key` | Decrypt a backup back into the vault |
| `mnemoscope-timestamp` | Anchor each journal entry's signature to a public OpenTimestamps calendar |

## Quickstart

```bash
# Bootstrap
mnemoscope-init /path/to/vault

# Wire the auto-journal hook (in ~/.claude/settings.json)
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "mnemoscope-record-hook" }]
      }
    ]
  }
}

# Verify
mnemoscope-verify /path/to/vault
# ok    2026-04-26T19:42:13.001Z  write  /vault/notes/foo.md
# 1 entries; 1 valid; 0 invalid
```

## Backup & restore the per-vault key

If you lose `<vault>/.mnemoscope/keys/ed25519.key`, the journal becomes unverifiable. The backup CLIs encrypt the key with a passphrase and let you restore it later:

```bash
mnemoscope-backup-key /path/to/vault /off-vault/backup.enc.json
# … prompts for a passphrase, writes chmod 0600 …

mnemoscope-restore-key /path/to/vault /off-vault/backup.enc.json
# … prompts for the same passphrase, writes the key back into the vault …
```

Algorithm: scrypt (N=32768, r=8, p=1) + AES-256-GCM, self-describing JSON envelope, no external dependencies. Lose the passphrase and the backup is unrecoverable. Full threat model in [docs/key-escrow.md](https://github.com/toonight/Mnemoscope/blob/main/docs/key-escrow.md).

## Anchor the journal in time with OpenTimestamps

The signed hash chain proves *order*. To prove *absolute time* and stay safe against retroactive rewrites if the per-vault key is ever compromised, anchor each entry's signature to a Bitcoin-backed public OpenTimestamps calendar:

```bash
mnemoscope-timestamp /path/to/vault
# … POSTs SHA-256(sig) per entry to the calendar, writes .ots proofs
# under <vault>/.mnemoscope/timestamps/. Idempotent.
```

Pending proofs are upgraded to fully self-verifying Bitcoin proofs with the upstream [`opentimestamps-client`](https://github.com/opentimestamps/opentimestamps-client) `ots upgrade` / `ots verify` CLIs — that part is intentionally not reimplemented. Full flow in [docs/timestamping.md](https://github.com/toonight/Mnemoscope/blob/main/docs/timestamping.md).

## Hook safety properties

`mnemoscope-record-hook` **never blocks the tool call**. Any internal error (missing payload field, unreadable file, etc.) is caught, logged to stderr, and the process exits 0. The vault root is resolved via `MNEMOSCOPE_VAULT_PATH` or by walking up to the closest `.mnemoscope/` directory.

Set `MNEMOSCOPE_HOOK_VERBOSE=1` to log every recorded op to stderr (visible in Claude Code's hook logs).

## Repo + docs

- Source, issues, releases: https://github.com/toonight/Mnemoscope
- Hook setup: https://github.com/toonight/Mnemoscope/blob/main/docs/claude-code-hook.md

## License

[Apache-2.0](https://github.com/toonight/Mnemoscope/blob/main/LICENSE).
