# Mnemoscope demo vault

A tiny synthetic vault designed to exercise every Mnemoscope tool.

| Folder    | Notes                              | Purpose                                   |
|-----------|------------------------------------|-------------------------------------------|
| `/`       | this README                        | hub note (lots of [[wikilinks]])          |
| `notes/`  | 8 short notes (≈ 50 tokens each)   | exercises **distractorDensity**           |
| `projects/` | 1 large fresh note (~6000 tokens) | exercises **tokenVolume**                 |
| `archive/` | 2 stale notes (>1 year old)        | exercises **freshnessSpread**             |

Run from the repo root:

```bash
mnemoscope-init examples/demo-vault
node packages/mcp-server/dist/index.js   # then call predict_rot, etc.
```

See `examples/demo-vault/SAMPLE-OUTPUT.md` for what each tool produces on this vault.
