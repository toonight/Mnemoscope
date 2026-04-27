# Anchoring the journal in time with OpenTimestamps

Mnemoscope's signed hash-chained journal proves *order* and *integrity*
relative to the per-vault Ed25519 key. It does **not** prove *absolute
time*: if the key is later compromised, an attacker who controls the
journal file could in principle re-write history with backdated entries
that still verify under the recovered key.

OpenTimestamps fixes that. Each entry's signature is hashed (SHA-256),
the digest is sent to a public OTS calendar, and the calendar returns a
binary proof that the digest existed at time `T`. Once the calendar
commits the digest into a Bitcoin block (typically within an hour), the
proof becomes a self-verifying anchor against the Bitcoin blockchain.
From that point on, even an attacker holding the Ed25519 key cannot
forge an entry that is *also* anchored at time `T`.

## Threat model

| Attacker has | Without OTS | With OTS |
|---|---|---|
| Read-only access to the journal | Cannot forge anything | Cannot forge anything |
| Recovered the per-vault key | Can rewrite the entire journal under their key | Cannot backdate entries past `T` because the OTS proof at `T` already commits to the original signatures |
| Both keys + a backdoor in the calendar | Game over | Bitcoin commitment still requires breaking SHA-256 |

OTS does not protect against a present-tense attacker who is *currently*
exfiltrating entries — only against retroactive rewrites of the past.

## Stamping a vault

```bash
mnemoscope-timestamp /path/to/vault
```

The CLI walks the journal and, for each entry that has no proof yet,
POSTs `SHA-256(signature)` to a public OTS calendar (default:
`https://alice.btc.calendar.opentimestamps.org`). It composes the
calendar's response into a valid `.ots` file and writes it to:

```
<vault>/.mnemoscope/timestamps/<sigHashHex>.ots
```

`sigHashHex` is the lowercase hex of the 32-byte SHA-256 digest of the
entry's base64url-encoded signature — i.e. the same digest that was
sent to the calendar.

Re-running on a vault with up-to-date proofs makes zero network
requests. Add it to a daily cron, after each significant batch of
agent activity, or after each release.

### Flags

- `--calendar URL` — point at a different (e.g. self-hosted) calendar.
- `--dry-run` — print what would be stamped, without making any
  network requests.

### Choosing a calendar

The default Alice/Bob calendars are run by the OpenTimestamps project
and are free, but a dedicated calendar gives stronger availability
guarantees. The OTS file format is calendar-agnostic; you can
re-stamp the same digest at multiple calendars and the resulting
proofs are independent.

## Upgrading and verifying

Pending proofs (the kind `mnemoscope-timestamp` produces) are valid as
soon as the calendar accepts the digest, but they're only fully
self-verifying once the calendar has committed the digest into a
Bitcoin block. Upgrading and verifying is **out of scope** for
Mnemoscope — use the upstream tooling:

```bash
# Once Bitcoin has confirmed the calendar commitment (~1 hour):
ots upgrade <vault>/.mnemoscope/timestamps/<sigHashHex>.ots
ots verify  <vault>/.mnemoscope/timestamps/<sigHashHex>.ots --digest <sigHashHex>
```

`ots` is the official OpenTimestamps CLI:
<https://github.com/opentimestamps/opentimestamps-client>.

We deliberately do not embed Bitcoin verification inside Mnemoscope —
it is a much larger surface than the rest of the project, and the
upstream tooling is the right authority anyway.

## What Mnemoscope does verify locally

`@mnemoscope/core` exports `verifyOtsHeaderForDigest(bytes, expectedDigest)`
which checks that:

- the OTS magic bytes are correct,
- the format version is `0x01`,
- the hash op is SHA-256 (`0x08`),
- the embedded 32-byte digest matches `expectedDigest`,
- the timestamp body is non-empty.

That is enough to confirm the proof structurally references the right
journal entry. The on-chain attestation is *not* checked — that
requires Bitcoin block headers and is left to `ots verify`.

## Why this is "chained signatures with OTS"

Mnemoscope's journal is already chained: entry `N`'s `prevHash` is the
SHA-256 of entry `N-1`'s signature, so the *order* of entries is
tamper-evident. With OTS on top, the *time* of each entry is also
tamper-evident, anchored against the most expensive-to-rewrite ledger
on the planet. The combination means that the same vault key can be
rotated, leaked, or even compromised, and the historical journal
remains intact because the OTS proofs predate the compromise.

## v0.2 limitations

- Only the calendar's pending commitment is fetched; upgrading is
  manual via the upstream CLI.
- One default calendar; `--calendar` can be set per-run but there is
  no built-in fan-out to multiple calendars yet.
- The proof file references `SHA-256(signature)`, not the canonical
  entry payload. This anchors the *signing event*, which is the right
  thing for tamper-evidence, but means the canonicalization of the
  payload is not itself anchored — re-canonicalizing must yield the
  same signature for the chain to verify, which the v1 canonicalizer
  guarantees.
