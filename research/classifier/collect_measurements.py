"""Collect real (signature, observed_loss) measurements for the classifier
by running the replication runner across procedurally-varied synthetic vaults.

For each variant we:

  1. Generate a synthetic Markdown vault with controlled parameters
     (note count, average size, redundancy, link/heading density,
     freshness spread). The parameters are drawn so the resulting
     5-factor signature spans the input space.
  2. Compute the signature via a Python port of @mnemoscope/core's
     ``rot-score.ts`` (bit-for-bit equivalent — see tests/).
  3. Extract needles from the vault and run a fixed set of
     replication-runner cells (model x size x position x structuring).
  4. Aggregate correctness across cells: ``observed_loss = 1 - accuracy``.
  5. Append a row to ``measurements.csv`` with the same schema as
     ``synthetic-large.csv``, ready for ``train.py``.

The replication runner falls back to the offline substring grader when
``MMB_LLM_API_KEY`` is not set; that path is **only** for sanity-checking
the pipeline. Rows produced offline are tagged so ``train.py`` can refuse
them. Pass ``--offline-ok`` to opt in (CI smoke testing only).

Usage:
    # local Ollama, free, slow:
    MMB_LLM_API_KEY=ollama \\
    MMB_LLM_ENDPOINT=http://localhost:11434/v1 \\
    uv run python -m classifier.collect_measurements \\
        --variants 50 --model llama3.1 --out classifier/measurements.csv

    # OpenAI, fast, ~$0.50 / 200 cells with gpt-4o-mini:
    MMB_LLM_API_KEY=sk-... \\
    uv run python -m classifier.collect_measurements \\
        --variants 50 --model gpt-4o-mini --out classifier/measurements.csv

    # smoke test, no API spend:
    uv run python -m classifier.collect_measurements \\
        --variants 3 --offline-ok --out /tmp/smoke.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import re
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

# Resolve the sibling 'replication' package without requiring uv-managed install.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from replication.needles import extract_needles  # noqa: E402
from replication.run import run_cell  # noqa: E402

# ---------------------------------------------------------------------------
# Python port of @mnemoscope/core/src/rot-score.ts -- bit-for-bit identical.
# Tested locally against the TS implementation on the demo-vault.
# ---------------------------------------------------------------------------

APPROX_CHARS_PER_TOKEN = 4
TOKEN_BUDGET_DEGRADATION_START = 50_000
TOKEN_BUDGET_DEGRADATION_HARD = 200_000


@dataclass(frozen=True)
class NoteSig:
    chars: int
    approx_tokens: int
    days_since_modified: float
    outbound_links: int
    heading_count: int


@dataclass(frozen=True)
class VaultSig:
    note_count: int
    total_chars: int
    approx_tokens: int
    notes: tuple[NoteSig, ...]


def _clamp(n: float) -> float:
    return max(0.0, min(100.0, n))


def extract_vault_signature(vault: Path) -> VaultSig:
    notes: list[NoteSig] = []
    now = time.time()
    for f in sorted(vault.rglob("*.md")):
        if "/.mnemoscope/" in str(f):
            continue
        text = f.read_text(encoding="utf-8")
        chars = len(text)
        st = f.stat()
        days_since = (now - st.st_mtime) / 86_400
        outbound_links = len(re.findall(r"\[\[[^\]]+\]\]", text)) + len(
            re.findall(r"\[[^\]]+\]\([^)]+\)", text)
        )
        heading_count = len(re.findall(r"^#{1,6}\s", text, re.MULTILINE))
        notes.append(
            NoteSig(
                chars=chars,
                approx_tokens=round(chars / APPROX_CHARS_PER_TOKEN),
                days_since_modified=round(days_since, 2),
                outbound_links=outbound_links,
                heading_count=heading_count,
            )
        )
    total_chars = sum(n.chars for n in notes)
    return VaultSig(
        note_count=len(notes),
        total_chars=total_chars,
        approx_tokens=round(total_chars / APPROX_CHARS_PER_TOKEN),
        notes=tuple(notes),
    )


def token_volume_factor(total_tokens: int) -> float:
    if total_tokens <= 0:
        return 0.0
    if total_tokens <= TOKEN_BUDGET_DEGRADATION_START:
        return _clamp((total_tokens / TOKEN_BUDGET_DEGRADATION_START) * 30)
    span = TOKEN_BUDGET_DEGRADATION_HARD - TOKEN_BUDGET_DEGRADATION_START
    overflow = min(total_tokens - TOKEN_BUDGET_DEGRADATION_START, span)
    return _clamp(30 + (overflow / span) * 70)


def semantic_redundancy_factor(notes: tuple[NoteSig, ...]) -> float:
    if len(notes) < 2:
        return 0.0
    total_chars = sum(n.chars for n in notes)
    if total_chars == 0:
        return 0.0
    sorted_notes = sorted(notes, key=lambda n: n.chars, reverse=True)
    top_count = max(1, math.floor(len(notes) * 0.1))
    top_share = sum(n.chars for n in sorted_notes[:top_count])
    ratio = top_share / total_chars
    return _clamp((ratio - 0.5) * 200)


def distractor_density_factor(notes: tuple[NoteSig, ...]) -> float:
    if not notes:
        return 0.0
    small = sum(1 for n in notes if 0 < n.approx_tokens < 200)
    return _clamp((small / len(notes)) * 100)


def structural_coherence_factor(notes: tuple[NoteSig, ...]) -> float:
    if not notes:
        return 0.0
    avg_links = sum(n.outbound_links for n in notes) / len(notes)
    avg_headings = sum(n.heading_count for n in notes) / len(notes)
    return _clamp(min(100, avg_links * 5 + avg_headings * 3))


def freshness_spread_factor(notes: tuple[NoteSig, ...]) -> float:
    if not notes:
        return 0.0
    stale = sum(1 for n in notes if n.days_since_modified > 180)
    return _clamp((stale / len(notes)) * 100)


def compute_factors(sig: VaultSig) -> dict[str, float]:
    return {
        "token_volume": token_volume_factor(sig.approx_tokens),
        "semantic_redundancy": semantic_redundancy_factor(sig.notes),
        "distractor_density": distractor_density_factor(sig.notes),
        "structural_coherence": structural_coherence_factor(sig.notes),
        "freshness_spread": freshness_spread_factor(sig.notes),
    }


# ---------------------------------------------------------------------------
# Synthetic vault generator. Each variant is a directory of .md files with
# parameters drawn so the resulting signature roughly spans the 5-factor
# space.
# ---------------------------------------------------------------------------

PROPER_NOUNS = [
    "Adelaide", "Brunelleschi", "Castellanos", "Demidovich", "Eleonora",
    "Faulkner", "Giordano", "Habermas", "Iturralde", "Janáček",
    "Kowalska", "Lagerkvist", "Marchetti", "Niedermeier", "Olszewski",
    "Pavlovsky", "Quintana", "Rasmussen", "Stepanovich", "Tsiolkovsky",
    "Ueno", "Vasquez", "Westerlund", "Xanthopoulos", "Yelchin", "Zorić",
]
PLACES = [
    "Lisbon", "Riga", "Tashkent", "Antwerp", "Reykjavik", "Salvador",
    "Hangzhou", "Chiang Mai", "Maputo", "Nicosia",
]
TOPICS = [
    "manuscript", "translation", "calibration", "manuscripture", "errata",
    "audit", "revision", "footnote", "marginalia", "preprint",
]


def _seeded_rng(seed: int) -> random.Random:
    return random.Random(seed)


def _proper_noun(rng: random.Random) -> str:
    return rng.choice(PROPER_NOUNS)


def _factual_sentence(rng: random.Random) -> str:
    person = _proper_noun(rng)
    place = rng.choice(PLACES)
    topic = rng.choice(TOPICS)
    year = rng.randint(1820, 2025)
    page = rng.randint(12, 998)
    return (
        f"{person} delivered the {topic} from {place} in {year}, "
        f"recorded on page {page} of the working ledger."
    )


def _filler_paragraph(rng: random.Random, *, length_chars: int) -> str:
    out: list[str] = []
    while sum(len(s) for s in out) < length_chars:
        person = _proper_noun(rng)
        place = rng.choice(PLACES)
        topic = rng.choice(TOPICS)
        out.append(
            f"In due course {person} reflected on the {topic} that {place} "
            f"had occasioned, noting the unevenness of the seasons "
            f"and the ledger's quiet refusal to settle."
        )
    return " ".join(out)[:length_chars]


def _note_body(
    rng: random.Random,
    *,
    target_chars: int,
    headings: int,
    links: int,
    needles: int,
) -> str:
    parts: list[str] = []
    # Top-level title — counts as 1 heading already.
    parts.append(f"# Note about {rng.choice(TOPICS)}\n")
    # Inject extra headings.
    for i in range(max(0, headings - 1)):
        parts.append(f"\n## Section {i + 1} — {_proper_noun(rng)}\n")
    # Inject the requested number of unique needle sentences (used by
    # replication.needles.extract_needles thanks to the proper noun + year).
    for _ in range(needles):
        parts.append("\n" + _factual_sentence(rng))
    # Filler.
    remaining = max(0, target_chars - sum(len(p) for p in parts))
    if remaining > 0:
        parts.append("\n" + _filler_paragraph(rng, length_chars=remaining))
    # Links at the very end.
    for _ in range(links):
        target = rng.choice(TOPICS)
        parts.append(f"\nSee also [[{target}-{rng.randint(0, 999)}]].")
    return "".join(parts)


@dataclass(frozen=True)
class VariantSpec:
    seed: int
    n_notes: int
    avg_chars_per_note: int
    n_distractors: int  # extra mini-notes (< 200 tokens) — drives distractor_density
    headings_per_note: int  # drives structural_coherence
    links_per_note: int  # drives structural_coherence
    redundancy_skew: float  # 0..1 — how much char mass concentrates in top notes (drives semantic_redundancy)
    stale_fraction: float  # 0..1 — fraction of notes with mtime older than 180d (drives freshness_spread)


def _draw_spec(rng: random.Random, seed: int) -> VariantSpec:
    return VariantSpec(
        seed=seed,
        n_notes=rng.randint(8, 80),
        # Wider range so token_volume can land anywhere from <30 to ~100.
        # 50 notes × 16k chars/note = 800k chars = 200k tokens, the cap.
        avg_chars_per_note=rng.randint(400, 16_000),
        n_distractors=rng.randint(0, 30),
        headings_per_note=rng.randint(0, 8),
        links_per_note=rng.randint(0, 15),
        # 0..1 maps to a Pareto exponent in _build_variant; 1.0 ≈ all mass on
        # top few notes (very high redundancy), 0.0 ≈ uniform (zero redundancy).
        redundancy_skew=rng.uniform(0.0, 1.0),
        stale_fraction=rng.uniform(0.0, 1.0),
    )


def _build_variant(spec: VariantSpec, out_dir: Path) -> None:
    """Materialise the variant on disk under ``out_dir``."""
    rng = _seeded_rng(spec.seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    notes_dir = out_dir / "notes"
    notes_dir.mkdir(exist_ok=True)

    # Distribute char mass across n_notes with a Pareto-like power law.
    # alpha controls the skew: 0.1 ≈ near-uniform (semantic_redundancy → 0),
    # 4.0 ≈ extreme concentration on note #0 (semantic_redundancy → 100).
    # A linear remap of redundancy_skew∈[0,1] to alpha∈[0.1, 4.0] gives the
    # generator enough headroom to cover the whole semantic_redundancy axis.
    alpha = 0.1 + spec.redundancy_skew * 3.9
    weights = [(i + 1) ** -alpha for i in range(spec.n_notes)]
    total_weight = sum(weights)
    target_per_note = [
        max(120, int((w / total_weight) * spec.avg_chars_per_note * spec.n_notes))
        for w in weights
    ]

    now = time.time()
    for i, target in enumerate(target_per_note):
        body = _note_body(
            rng,
            target_chars=target,
            headings=spec.headings_per_note,
            links=spec.links_per_note,
            needles=2,  # two factual sentences per note ensures extract_needles finds material
        )
        f = notes_dir / f"note-{i:03d}.md"
        f.write_text(body, encoding="utf-8")
        # Stale a fraction of notes by backdating mtime by > 180 days.
        if rng.random() < spec.stale_fraction:
            stale_ts = now - (200 + rng.random() * 400) * 86_400
            os.utime(f, (stale_ts, stale_ts))

    # Distractors — short notes that drive distractor_density up.
    distractors_dir = out_dir / "distractors"
    distractors_dir.mkdir(exist_ok=True)
    for j in range(spec.n_distractors):
        body = _factual_sentence(rng) + "\n"
        f = distractors_dir / f"d-{j:03d}.md"
        f.write_text(body, encoding="utf-8")


# ---------------------------------------------------------------------------
# Driver: per variant, build vault, compute signature, run cells, aggregate.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class VariantOutcome:
    factors: dict[str, float]
    observed_loss: float
    n_cells: int
    n_correct: int
    wall_clock_ms: int
    tokens_in: int  # 0 means "endpoint did not report usage" (or offline)
    tokens_out: int


def _measure_variant(
    spec: VariantSpec,
    *,
    workdir: Path,
    model: str,
    sizes: tuple[int, ...],
    positions: tuple[str, ...],
    needles_per_vault: int,
    offline: bool,
) -> VariantOutcome | None:
    """Build the variant, run the cells, return aggregates per variant.

    Returns None when the variant has zero extractable needles (which can
    happen for very small / very stale corpora) -- that variant is skipped.
    """
    variant_dir = workdir / f"variant-{spec.seed:06d}"
    if variant_dir.exists():
        shutil.rmtree(variant_dir)
    _build_variant(spec, variant_dir)

    sig = extract_vault_signature(variant_dir)
    factors = compute_factors(sig)

    needles = extract_needles(variant_dir, limit=needles_per_vault)
    if not needles:
        return None

    cells_correct = 0
    cells_total = 0
    elapsed_ms_total = 0
    tokens_in_total = 0
    tokens_out_total = 0
    for size in sizes:
        for needle in needles:
            for structuring in ("structured", "shuffled"):
                for position in positions:
                    cell = run_cell(
                        vault_root=variant_dir,
                        model=model,
                        target_tokens=size,
                        structuring=structuring,
                        position=position,
                        needle=needle,
                        offline=offline,
                    )
                    cells_total += 1
                    if cell.correct:
                        cells_correct += 1
                    elapsed_ms_total += cell.elapsed_ms
                    if cell.tokens_in is not None:
                        tokens_in_total += cell.tokens_in
                    if cell.tokens_out is not None:
                        tokens_out_total += cell.tokens_out

    if cells_total == 0:
        return None
    accuracy = cells_correct / cells_total
    return VariantOutcome(
        factors=factors,
        observed_loss=1.0 - accuracy,
        n_cells=cells_total,
        n_correct=cells_correct,
        wall_clock_ms=elapsed_ms_total,
        tokens_in=tokens_in_total,
        tokens_out=tokens_out_total,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variants", type=int, default=50, help="Number of synthetic vault variants.")
    parser.add_argument("--model", default="gpt-4o-mini", help="Model name passed to the LLM endpoint.")
    parser.add_argument(
        "--sizes",
        default="3000,8000",
        help="Comma-separated target token sizes for the haystack.",
    )
    parser.add_argument(
        "--positions",
        default="middle",
        help="Comma-separated needle positions (start | middle | end).",
    )
    parser.add_argument(
        "--needles-per-vault",
        type=int,
        default=2,
        help="Cap on extracted needles per variant (each needle = 2 cells).",
    )
    parser.add_argument("--seed-base", type=int, default=10_000, help="Base seed; variant seeds are seed-base + i.")
    parser.add_argument(
        "--offline-ok",
        action="store_true",
        help="Allow rows produced by the offline substring grader. Sanity check only — DO NOT train on this.",
    )
    parser.add_argument("--out", type=Path, required=True, help="Output measurements.csv.")
    parser.add_argument(
        "--workdir",
        type=Path,
        default=None,
        help="Where to materialise synthetic vaults. Defaults to a tmpdir, removed on exit.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build vaults and compute signatures, but do NOT run cells. Estimates LLM call count.",
    )
    args = parser.parse_args()

    sizes = tuple(int(s.strip()) for s in args.sizes.split(",") if s.strip())
    positions = tuple(p.strip() for p in args.positions.split(",") if p.strip())
    for p in positions:
        if p not in ("start", "middle", "end"):
            raise SystemExit(f"invalid position {p!r}; must be one of start | middle | end")

    api_key_present = bool(os.environ.get("MMB_LLM_API_KEY"))
    offline = not api_key_present
    if offline and not args.offline_ok and not args.dry_run:
        raise SystemExit(
            "MMB_LLM_API_KEY is not set. Real measurements require a real LLM endpoint.\n"
            "  - To smoke-test the pipeline only, pass --offline-ok (rows tagged offline=1).\n"
            "  - To estimate the LLM call count, pass --dry-run.\n"
            "  - To collect real data, export MMB_LLM_API_KEY=... and (optionally) MMB_LLM_ENDPOINT=...,\n"
            "    then re-run."
        )

    rng = _seeded_rng(args.seed_base)
    specs = [_draw_spec(rng, seed=args.seed_base + i) for i in range(args.variants)]

    cells_per_variant = len(sizes) * args.needles_per_vault * 2 * len(positions)
    total_cells_estimate = cells_per_variant * args.variants
    print(
        f"Plan: {args.variants} variants × {cells_per_variant} cells = "
        f"~{total_cells_estimate} LLM calls (some variants may yield fewer needles)."
    )
    if args.dry_run:
        print("dry-run: building vaults + computing signatures only, no LLM calls.")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    workdir_ctx: tempfile.TemporaryDirectory | None = None
    if args.workdir is None:
        workdir_ctx = tempfile.TemporaryDirectory(prefix="mnemoscope-collect-")
        workdir = Path(workdir_ctx.name)
    else:
        workdir = args.workdir
        workdir.mkdir(parents=True, exist_ok=True)

    field_order = [
        "token_volume",
        "semantic_redundancy",
        "distractor_density",
        "structural_coherence",
        "freshness_spread",
        "observed_loss",
        "n_cells",
        "model",
        "offline",
        "seed",
        "wall_clock_ms",
        "tokens_in",
        "tokens_out",
    ]
    rows: list[dict[str, float | int]] = []
    csv_fh = None
    csv_writer = None
    if not args.dry_run:
        csv_fh = args.out.open("w", encoding="utf-8", newline="")
        csv_writer = csv.DictWriter(csv_fh, fieldnames=field_order)
        csv_writer.writeheader()
        csv_fh.flush()

    # Grand totals across the whole collection — surfaced in collection-meta.json.
    grand_total_wall_clock_ms = 0
    grand_total_tokens_in = 0
    grand_total_tokens_out = 0
    grand_total_cells = 0
    variants_kept = 0
    variants_skipped_no_needles = 0
    variants_failed = 0
    collection_started = time.time()
    try:
        for i, spec in enumerate(specs, start=1):
            print(f"  [{i}/{args.variants}] seed={spec.seed} n_notes={spec.n_notes} "
                  f"avg_chars={spec.avg_chars_per_note} skew={spec.redundancy_skew:.2f} "
                  f"stale={spec.stale_fraction:.2f}")
            if args.dry_run:
                variant_dir = workdir / f"variant-{spec.seed:06d}"
                if variant_dir.exists():
                    shutil.rmtree(variant_dir)
                _build_variant(spec, variant_dir)
                sig = extract_vault_signature(variant_dir)
                factors = compute_factors(sig)
                print(f"      sig: {factors}")
                continue
            try:
                outcome = _measure_variant(
                    spec,
                    workdir=workdir,
                    model=args.model,
                    sizes=sizes,
                    positions=positions,
                    needles_per_vault=args.needles_per_vault,
                    offline=offline,
                )
            except Exception as e:
                print(f"      variant failed: {e!r}")
                variants_failed += 1
                continue
            if outcome is None:
                print("      skipped: no extractable needles")
                variants_skipped_no_needles += 1
                continue
            print(
                f"      loss={outcome.observed_loss:.3f} "
                f"({outcome.n_correct}/{outcome.n_cells} correct, "
                f"{outcome.wall_clock_ms / 1000:.1f}s, "
                f"tokens_in={outcome.tokens_in})"
            )
            row = {
                **outcome.factors,
                "observed_loss": outcome.observed_loss,
                "n_cells": outcome.n_cells,
                "model": args.model,
                "offline": int(offline),
                "seed": spec.seed,
                "wall_clock_ms": outcome.wall_clock_ms,
                "tokens_in": outcome.tokens_in,
                "tokens_out": outcome.tokens_out,
            }
            rows.append(row)
            grand_total_wall_clock_ms += outcome.wall_clock_ms
            grand_total_tokens_in += outcome.tokens_in
            grand_total_tokens_out += outcome.tokens_out
            grand_total_cells += outcome.n_cells
            variants_kept += 1
            if csv_writer is not None and csv_fh is not None:
                csv_writer.writerow(row)
                csv_fh.flush()
    finally:
        if csv_fh is not None:
            csv_fh.close()
        if workdir_ctx is not None:
            workdir_ctx.cleanup()

    if args.dry_run:
        print(f"dry-run complete: {len(specs)} variants built, no rows written.")
        return

    if not rows:
        raise SystemExit("collected zero rows -- every variant skipped. Check your config.")

    # Sibling collection-meta.json -- the audit trail train.py picks up via
    # --collection-meta to embed under model.json#dataset_collection.
    meta = {
        "model": args.model,
        "endpoint": os.environ.get("MMB_LLM_ENDPOINT", "https://api.openai.com/v1"),
        "offline": offline,
        "started_at": collection_started,
        "ended_at": time.time(),
        "wall_clock_s": round(time.time() - collection_started, 1),
        "wall_clock_s_grading_only": round(grand_total_wall_clock_ms / 1000, 1),
        "variants_attempted": len(specs),
        "variants_kept": variants_kept,
        "variants_skipped_no_needles": variants_skipped_no_needles,
        "variants_failed": variants_failed,
        "total_cells": grand_total_cells,
        "total_tokens_input": grand_total_tokens_in,
        "total_tokens_output": grand_total_tokens_out,
        "config": {
            "sizes": list(sizes),
            "positions": list(positions),
            "needles_per_vault": args.needles_per_vault,
            "seed_base": args.seed_base,
        },
    }
    meta_path = args.out.with_name(args.out.stem + "-meta.json")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"\nwrote {args.out}  rows={len(rows)}  offline={offline}")
    print(f"wrote {meta_path}")
    print(
        f"  wall-clock total: {meta['wall_clock_s']:.1f}s "
        f"(grading only: {meta['wall_clock_s_grading_only']:.1f}s)"
    )
    print(f"  cells executed:   {grand_total_cells}")
    print(
        f"  LLM tokens:       in={grand_total_tokens_in} "
        f"out={grand_total_tokens_out}"
    )
    if offline:
        print(
            "WARNING: rows were graded by the offline substring grader. "
            "DO NOT train the classifier on this CSV. Set MMB_LLM_API_KEY and re-run."
        )


if __name__ == "__main__":
    main()
