# Backing up and restoring the per-vault key

Mnemoscope generates a fresh Ed25519 keypair the first time you run `mnemoscope-init` on a vault. That keypair is the only thing that can sign and verify the journal — so if you lose `<vault>/.mnemoscope/keys/ed25519.key`, every existing journal entry becomes unverifiable. The escrow flow exists so that loss does not have to be permanent.

## Threat model

The escrow path addresses **accidental loss** (machine failure, accidental `rm`, vault repo wiped). It does **not** address an attacker who already controls your vault — at that point they have the active key. Treat the encrypted backup as you would treat a password manager export.

What the encrypted backup is built from:

- **AES-256-GCM** for the cipher (authenticated encryption, no need for a separate MAC).
- **scrypt** for the KDF (`N=32768`, `r=8`, `p=1`) — derives a 32-byte symmetric key from your passphrase.
- **16-byte salt** + **12-byte IV**, both fresh per backup, both stored in the envelope.
- The plaintext is the same PEM-encoded PKCS8 Ed25519 private key Mnemoscope wrote to disk.

The output is a self-describing JSON file with `version: 1`. Forward incompatibility is rejected (e.g. `version: 99` raises a clear error) so we can swap algorithms in v2 without ambiguity.

## Backing up

```bash
mnemoscope-backup-key /path/to/vault /path/to/backup.enc.json
```

The CLI prompts twice for a passphrase (≥ 8 characters). Set `MNEMOSCOPE_PASSPHRASE` to skip the prompt in scripts:

```bash
MNEMOSCOPE_PASSPHRASE='correct horse battery staple' \
  mnemoscope-backup-key /path/to/vault /path/to/backup.enc.json --comment "off-site backup 2026-04-26"
```

The output file is `chmod 0600`. The original private key is left in place — this is a **backup**, not a move.

## Restoring

```bash
mnemoscope-restore-key /path/to/vault /path/to/backup.enc.json
```

By default the CLI refuses to overwrite an existing private key — pass `--overwrite` to force it. After a successful restore, run `mnemoscope-verify` to confirm the journal still verifies under the recovered key.

```bash
mnemoscope-verify /path/to/vault
# 12 entries; 12 valid; 0 invalid
```

## Recommended hygiene

- Store the encrypted backup somewhere **outside** the vault: a different drive, a different machine, a cloud bucket, etc.
- Use a passphrase manager. The encryption is only as strong as the passphrase.
- Make a fresh backup whenever the journal is rotated (planned for v0.3).
- Do not commit `.mnemoscope/` to git. The Mnemoscope `.gitignore` template excludes it.

## What the backup file looks like

```json
{
  "version": 1,
  "kdf": "scrypt",
  "kdfParams": { "N": 32768, "r": 8, "p": 1 },
  "salt": "…16 bytes base64…",
  "cipher": "aes-256-gcm",
  "iv": "…12 bytes base64…",
  "ciphertext": "…",
  "tag": "…16 bytes base64…",
  "keyType": "ed25519-pkcs8-pem",
  "comment": "off-site backup 2026-04-26"
}
```

The format is small (under 1 KB) and human-readable except for the two binary blobs.

## Limitations (v0.2)

- Single-passphrase only. Shamir secret sharing across N locations is not in v0.2.
- No remote attestation. If you need a third party to attest that you produced a backup at time `T`, that lives elsewhere (a notary service, a Bitcoin OTS commitment) — out of scope for v0.2.
- The backup encrypts only the **private** key. The journal itself is not encrypted; it remains in `<vault>/.mnemoscope/journal.jsonl` in the clear.
