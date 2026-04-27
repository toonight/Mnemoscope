"""Build paired structured / shuffled haystacks for the Chroma replication.

For a target context size (in approximate tokens), produce two haystacks
of the same total token count from the same set of source notes:

  - structured: notes concatenated in tier order (working → episodic →
    semantic), each note kept whole with its original heading + body,
    in a coherent narrative.
  - shuffled: the same source material split into paragraphs and
    permuted with a fixed seed, so that surface coherence is destroyed
    while the same tokens remain.

The needle is always inserted into the haystack at a position that
mirrors its position in the structured form (so that 'lost in the
middle' effects, if any, fall similarly on both).
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass
from pathlib import Path

from .needles import Needle


_APPROX_CHARS_PER_TOKEN = 4
_PARAGRAPH_RE = re.compile(r"\n\s*\n")


@dataclass(frozen=True)
class HaystackPair:
    structured: str
    shuffled: str
    target_tokens: int
    actual_tokens: int


def _approx_tokens(text: str) -> int:
    return len(text) // _APPROX_CHARS_PER_TOKEN


def collect_notes(vault_root: Path) -> list[tuple[Path, str]]:
    files = sorted(p for p in vault_root.rglob("*.md") if "/.mnemoscope/" not in str(p))
    return [(f, f.read_text(encoding="utf-8")) for f in files]


def build_pair(
    vault_root: Path,
    needle: Needle,
    *,
    target_tokens: int,
    seed: int = 1,
) -> HaystackPair:
    """Build a structured/shuffled haystack pair around `needle`."""
    notes = collect_notes(vault_root)

    # Pad with copies of the corpus until we reach the target.
    structured_parts: list[str] = []
    while _approx_tokens("\n\n".join(structured_parts)) < target_tokens:
        for path, content in notes:
            structured_parts.append(f"--- {path.relative_to(vault_root)} ---\n{content}")
            if _approx_tokens("\n\n".join(structured_parts)) >= target_tokens:
                break

    structured = "\n\n".join(structured_parts)

    # Shuffled: split into paragraphs, permute with a fixed seed.
    paragraphs = _PARAGRAPH_RE.split(structured)
    rng = random.Random(seed)
    rng.shuffle(paragraphs)
    shuffled = "\n\n".join(paragraphs)

    return HaystackPair(
        structured=structured,
        shuffled=shuffled,
        target_tokens=target_tokens,
        actual_tokens=_approx_tokens(structured),
    )


def main() -> None:
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Inspect a haystack pair built around the first needle.")
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--target-tokens", type=int, default=5_000)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    from .needles import extract_needles

    needles = extract_needles(args.vault, limit=1)
    if not needles:
        raise SystemExit("no needles extractable from vault")
    pair = build_pair(args.vault, needles[0], target_tokens=args.target_tokens, seed=args.seed)
    print(json.dumps(
        {
            "needle": needles[0].text,
            "target_tokens": pair.target_tokens,
            "actual_tokens": pair.actual_tokens,
            "structured_first_500": pair.structured[:500],
            "shuffled_first_500": pair.shuffled[:500],
        },
        indent=2,
    ))


if __name__ == "__main__":
    main()
