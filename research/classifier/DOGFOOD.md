# DOGFOOD — collect real measurements for the predictive context-rot classifier

The classifier currently sits at **🟡 synthetic baseline** (R² = 0.85 on
the 1 000-row procedurally-generated set; see [`README.md`](./README.md)).
To move it to **🟢 calibrated against real LLM accuracy loss**, we need
real `(signature, observed_loss)` pairs collected by running the
replication runner on procedurally-varied synthetic vaults against a
real LLM endpoint.

This page is the runbook for that collection. Pick your endpoint, run
one command, retrain.

## What `collect_measurements.py` does

For each variant *i* in `1..N`:

1. **Generates** a synthetic Markdown vault under a tmpdir, with note
   count, average note size, redundancy skew, distractor count, link /
   heading density, and freshness spread drawn so the resulting
   5-factor signature spans the input space.
2. **Computes the signature** in Python (a bit-for-bit port of
   `@mnemoscope/core/src/rot-score.ts`). The Python implementation is
   only used as the *label-side* feature extractor — the runtime still
   uses the TS one.
3. **Extracts needles** with `replication.needles.extract_needles` (the
   exact same path the replication runner uses for real corpora).
4. **Runs `replication.run.run_cell`** for every (size × position ×
   structuring × needle) combination, hitting your LLM endpoint.
5. **Aggregates** correctness across cells:
   `observed_loss = 1 - mean(cell.correct)`.
6. **Appends one row** to `measurements.csv` with the same schema as
   `synthetic-large.csv`, plus `n_cells`, `model`, `offline`, `seed`
   audit columns.

After the run, point `train.py` at `measurements.csv` and let it
compare ridge / rf / gbr; whichever wins on the held-out R² gets
exported to `model.onnx`.

## Cost estimate

Defaults: `--variants 50`, `--sizes 3000,8000`, `--positions middle`,
`--needles-per-vault 2` → **8 cells / variant**, ≈ **400 LLM calls** for
50 variants.

| Endpoint | Cost / 400 calls | Wall time | Quality of label |
|---|---|---|---|
| **OpenAI gpt-4o-mini** | ≈ \$0.40 | 5–10 min | High signal, modern instruct model |
| **OpenAI gpt-4o** | ≈ \$3.50 | 5–10 min | Highest signal, but you don't need it for this |
| **Anthropic claude-haiku-4.5** | ≈ \$0.50 | 5–10 min | High signal |
| **Together / Fireworks (open-weights)** | ≈ \$0.10 | 10–20 min | Lower signal but plenty for v1 calibration |
| **Local Ollama (`llama3.1:8b` etc.)** | \$0 | 30–90 min | Lowest signal, fine for sanity / iteration |

Pass `--variants 200` if you want more rows — multiply costs by 4.

## Recipe — OpenAI

```bash
cd research
uv sync

export MMB_LLM_API_KEY=sk-...                                    # your OpenAI key
uv run python -m classifier.collect_measurements \
    --variants 50 \
    --model gpt-4o-mini \
    --out classifier/measurements.csv

uv run python -m classifier.train \
    --data classifier/measurements.csv \
    --out classifier/model.onnx \
    --models ridge rf gbr
```

## Recipe — Anthropic

The replication runner is OpenAI-compatible at the wire level, so the
trick is to point it at a thin proxy or use `MMB_LLM_ENDPOINT` if you
have one set up. For now, the simplest route is:

```bash
export MMB_LLM_API_KEY=sk-ant-...                                # Anthropic key
export MMB_LLM_ENDPOINT=https://api.anthropic.com/v1             # Anthropic OpenAI-compatible base
uv run python -m classifier.collect_measurements \
    --variants 50 \
    --model claude-haiku-4-5-20251001 \
    --out classifier/measurements.csv
```

If you hit `model not found`, double-check the model ID against the
Anthropic dashboard.

## Recipe — Local Ollama (free, slow)

```bash
# 1. start ollama and pull a small instruct model
ollama serve &                                                  # if not already running
ollama pull llama3.1:8b

# 2. point the runner at the local OpenAI-compatible endpoint
export MMB_LLM_API_KEY=ollama                                   # any non-empty value works
export MMB_LLM_ENDPOINT=http://localhost:11434/v1
uv run python -m classifier.collect_measurements \
    --variants 50 \
    --model llama3.1:8b \
    --out classifier/measurements.csv
```

Quality of labels will be lower than gpt-4o-mini — fine for ordering
factors, marginal for absolute calibration.

## Sanity check before burning budget

```bash
uv run python -m classifier.collect_measurements \
    --variants 5 --dry-run --out /tmp/dryrun.csv
```

`--dry-run` builds the synthetic vaults, computes their signatures, and
prints them — but does **not** call the LLM. Use it to verify your
signatures span the 5-factor space before committing to a paid run.

## Ground rules (so the dataset is honest)

- **Never train on offline rows.** The runner falls back to a substring
  grader when `MMB_LLM_API_KEY` is unset. Those rows are tagged
  `offline=1` in the CSV; `train.py` knows to refuse them.
- **Always commit the resulting `measurements.csv`** alongside the
  retrained `model.onnx` and `model.json`. Reproducibility costs nothing
  and lets reviewers replay the comparison.
- **Pin the model name** in `--model`. Don't conflate gpt-4o and
  gpt-4o-mini in one CSV; if you really want both, run two separate
  collections and let `train.py` learn from the union.

## What good looks like

When you retrain on `measurements.csv` you should see:

- Random Forest or Gradient Boosting **beating** Ridge — the relationship
  between the 5 factors and real LLM loss is non-linear, RF/GBR captures
  it, Ridge can't.
- R² in the 0.4–0.7 range on the held-out 20 %. If it's > 0.9 something
  is wrong (likely a leak between feature and label, e.g. needle text
  appearing in the haystack uncorrupted).
- Per-factor variance: confirm `factors.std()` over the rows is > ~10 on
  every column. If a factor is constant across rows, the variant
  generator under-covers that axis and the model can't learn anything
  about it.

## After a successful collection

Update the README scientific-posture row from 🟡 to 🟢, link the
`measurements.csv` and the new `model.json` metadata, and bump the v0
heuristic in `core` to load `model.onnx` via `onnxruntime-node` (the
"Replace the v0 heuristic" item on the roadmap).
