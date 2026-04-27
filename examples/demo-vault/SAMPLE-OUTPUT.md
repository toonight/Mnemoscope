# Sample output on the demo vault

Captured from a real run on this 13-note synthetic vault (April 2026).

## `mnemoscope-init examples/demo-vault`

```
Initialized Mnemoscope in /…/Mnemoscope/examples/demo-vault.
  vault root:  /…/Mnemoscope/examples/demo-vault
  state dir:   /…/Mnemoscope/examples/demo-vault/.mnemoscope
  journal:     /…/Mnemoscope/examples/demo-vault/.mnemoscope/journal.jsonl
  public key:  /…/Mnemoscope/examples/demo-vault/.mnemoscope/keys/ed25519.pub
  fingerprint: 6620dcca40afb739

Next steps:
  1. Add the MCP server to your client.
  2. (Optional) Wire the auto-journal hook in ~/.claude/settings.json.
  3. Use 'mnemoscope-verify' to check the journal at any time.
```

## `predict_rot` MCP call

```text
rot_risk: 52/100  dominant: semanticRedundancy
vault: 13 notes, 83,351 tokens

factors:
  tokenVolume             46/100
  semanticRedundancy      99/100
  distractorDensity       85/100
  structuralCoherence     16/100
  freshnessSpread         15/100

top_risk_notes:
  - projects/big-project.md   (82754 tok · very large note)
  - archive/old-research.md   (70 tok · stale (>1y))
  - archive/legacy.md         (53 tok · stale (>1y))
  - README.md                 (224 tok · baseline)
  - notes/index.md            (105 tok · baseline)
```

The vault was deliberately built so that **every factor moves**:

- `projects/big-project.md` is a single ~83 K-token file → drives `tokenVolume` to 46 and `semanticRedundancy` to 99 (the top 10 % of files holds essentially all the chars).
- `notes/note-1.md` … `notes/note-8.md` are tiny (≈50 tokens each) → drive `distractorDensity` to 85.
- `archive/legacy.md` and `archive/old-research.md` are backdated to 2024-03-15 → drive `freshnessSpread` to 15.
- The `notes/index.md` hub wikilinks everything, which would normally lift `structuralCoherence` — but Chroma 2025 showed structure can *hurt* needle retrieval, so the heuristic treats it as risk, not virtue. Here the average is small, so it stays low (16/100).

## `get_tiered_read`

```text
policy: working≤7d  episodic≤90d
counts: working=11  episodic=0  semantic=2

semantic (older than 90d):
  - archive/legacy.md       (53 tok · 773d)
  - archive/old-research.md (70 tok · 773d)
```

The two backdated archive notes are correctly placed in `semantic`; everything else, freshly written, sits in `working`.

## `record_journal × 3` then `mnemoscope-verify`

Three signed entries, hash-chained:

```text
entry 1 op=write  prevHash=GENESIS
entry 2 op=write  prevHash=21e7ed601a81d048…
entry 3 op=read   prevHash=2cbf900315df6908…
```

```bash
$ mnemoscope-verify examples/demo-vault
ok    2026-04-27T01:47:27.968Z  write  examples/demo-vault/notes/note-1.md
ok    2026-04-27T01:47:27.998Z  write  examples/demo-vault/projects/big-project.md
ok    2026-04-27T01:47:28.029Z  read   examples/demo-vault/README.md

3 entries; 3 valid; 0 invalid
$ echo "exit=$?"
exit=0
```

## Tamper test

Modify entry 2's `path` field directly in `journal.jsonl`, change it to `HACKED.md`, and re-run:

```bash
$ mnemoscope-verify examples/demo-vault
ok    2026-04-27T01:47:27.968Z  write  examples/demo-vault/notes/note-1.md
FAIL  2026-04-27T01:47:27.998Z  write  examples/demo-vault/HACKED.md  (signature mismatch)
ok    2026-04-27T01:47:28.029Z  read   examples/demo-vault/README.md

3 entries; 2 valid; 1 invalid
$ echo "exit=$?"
exit=1
```

Same kind of result for entry deletion (`chain break: prevHash=… but expected …`) and for entries signed by a key other than the current vault's (`signed by unknown key …`).
