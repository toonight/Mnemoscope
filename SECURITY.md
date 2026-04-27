# Security policy

## Reporting a vulnerability

Please report security issues privately by opening a [GitHub Security Advisory](https://github.com/toonight/Mnemoscope/security/advisories/new). Public issues are appropriate for everything else, but a coordinated disclosure path matters when sensitive material is involved — and Mnemoscope's threat model touches on private notes, agent journals, and signing keys.

We aim to acknowledge within 7 days and will work with you on a coordinated disclosure timeline appropriate to the severity.

## Threat model (v0.1)

Mnemoscope is local-first. The threats it tries to address are not network attackers — they are:

| Threat | Mitigation |
|---|---|
| An LLM agent silently overwrites a vault file you cared about. | The journal records every Write/Edit/MultiEdit (when the auto-journal hook is wired); `mnemoscope-verify` proves which entries are intact. |
| Someone tampers with the journal to hide a write. | Every entry is signed with a per-vault Ed25519 key. Field-level edits invalidate signatures; entry deletion or reordering breaks the prevHash chain. Both are caught by `mnemoscope-verify`. |
| An attacker with read-write access to `.mnemoscope/keys/ed25519.key` forges a journal. | They can — at that point they already control the signing key. Treat the key as you would a password manager's master key (back up, never commit, restrict permissions). The file is created with mode `0600`. |
| The auto-journal hook crashes and blocks Claude Code. | The hook *never* blocks: every internal error is caught, logged to stderr, and the process exits 0. |
| Prompt-injected content asks the agent to call `record_journal` with bogus data. | `record_journal` records what the agent gives it. The signature is valid — it just attests to whatever was written. The journal proves *what was claimed*, not *that the claim is true*. The Mnemoscope MCP server itself does not act on journal content. |

## What v0.1 does *not* protect against

- **Truncation at the file system layer.** Although the prevHash chain detects truncation when the journal is read end-to-end, an attacker who controls the file system can also discard the keypair and start over. Defense-in-depth (off-vault key escrow, periodic remote attestation) is on the v1 roadmap.
- **Side channels.** A malicious Obsidian plugin running in your vault can read everything Mnemoscope reads.
- **Networked agent leaks.** If your MCP client streams vault content to a remote model, the journal records that the read happened — it does not prevent the read.

## Disclosure timeline

| Severity | Acknowledgement | Fix target |
|---|---|---|
| Critical (signing-key disclosure, signature forgery) | ≤ 24 hours | ≤ 7 days |
| High (silent corruption of journal that bypasses `verifyAll`) | ≤ 72 hours | ≤ 14 days |
| Medium (DoS in the auto-journal hook, e.g. infinite loop on a malformed payload) | ≤ 7 days | ≤ 30 days |
| Low (informational, hardening) | ≤ 14 days | next minor release |
