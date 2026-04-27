"""Build paired structured / shuffled haystacks for the Chroma replication.

For a target context size (in approximate tokens), produce two haystacks
of the same total token count from the same set of source notes:

  - structured: notes concatenated in tier order (working → episodic →
    semantic), each note kept whole with its original heading + body,
    in a coherent narrative.
  - shuffled: the same source material split into paragraphs and
    permuted with a fixed seed, so that surface coherence is destroyed
    while the same tokens remain.

To disentangle the *structuring* effect (Chroma 2025) from the
*position* effect (Lost in the Middle, Liu et al. 2023), the needle
is removed from the natural padding and re-inserted at a controlled
position — `start`, `middle`, or `end` of the haystack. The position
is preserved across the structured/shuffled pair so that any
structured-vs-shuffled delta is comparable at a fixed position.
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass
from pathlib import Path

from .needles import Needle

_APPROX_CHARS_PER_TOKEN = 4
_PARAGRAPH_RE = re.compile(r"\n\s*\n")
_NEEDLE_MARKER = "[MNEMOSCOPE-NEEDLE]"
_REDACTED_MARKER = "[MNEMOSCOPE-REDACTED-FOR-POSITION-TEST]"

_VALID_POSITIONS = ("start", "middle", "end")


@dataclass(frozen=True)
class HaystackPair:
    structured: str
    shuffled: str
    target_tokens: int
    actual_tokens: int
    needle_position: str
    needle_relative_offset: float  # 0.0..1.0, where the needle paragraph sits in the haystack


def _approx_tokens(text: str) -> int:
    return len(text) // _APPROX_CHARS_PER_TOKEN


def collect_notes(vault_root: Path) -> list[tuple[Path, str]]:
    files = sorted(p for p in vault_root.rglob("*.md") if "/.mnemoscope/" not in str(p))
    return [(f, f.read_text(encoding="utf-8")) for f in files]


def _redact_needle(content: str, needle_text: str) -> str:
    """Remove every occurrence of the needle from a note so the only
    instance left in the haystack is the one we explicitly insert."""
    return content.replace(needle_text, _REDACTED_MARKER)


def _resolve_position_index(position: str, n: int) -> int:
    """Return the paragraph index at which to insert the needle so it
    lands at the requested position of an `n`-paragraph haystack."""
    if position not in _VALID_POSITIONS:
        raise ValueError(f"position must be one of {_VALID_POSITIONS}, got {position!r}")
    if position == "start":
        return 0
    if position == "end":
        return n
    return n // 2


def build_pair(
    vault_root: Path,
    needle: Needle,
    *,
    target_tokens: int,
    position: str = "middle",
    seed: int = 1,
) -> HaystackPair:
    """Build a structured/shuffled haystack pair around `needle`.

    The needle is redacted from the natural padding and re-inserted at
    `position` ("start" | "middle" | "end") in both haystacks, so that
    a structured-vs-shuffled delta at fixed position is interpretable
    independently of any lost-in-the-middle effect.
    """
    if position not in _VALID_POSITIONS:
        raise ValueError(f"position must be one of {_VALID_POSITIONS}, got {position!r}")

    notes = collect_notes(vault_root)

    # 1. Build the padding by cycling over the corpus, redacting the
    #    needle from each note so the only instance left is the one we
    #    insert explicitly below.
    padding_parts: list[str] = []
    while _approx_tokens("\n\n".join(padding_parts)) < target_tokens:
        for path, content in notes:
            redacted = _redact_needle(content, needle.text)
            padding_parts.append(f"--- {path.relative_to(vault_root)} ---\n{redacted}")
            if _approx_tokens("\n\n".join(padding_parts)) >= target_tokens:
                break

    padding = "\n\n".join(padding_parts)
    padding_paragraphs = _PARAGRAPH_RE.split(padding)

    # 2. Insert the needle paragraph at the requested position in the
    #    structured haystack.
    needle_paragraph = f"{_NEEDLE_MARKER} {needle.text}"
    insert_idx = _resolve_position_index(position, len(padding_paragraphs))
    structured_paragraphs = padding_paragraphs[:insert_idx] + [needle_paragraph] + padding_paragraphs[insert_idx:]
    structured = "\n\n".join(structured_paragraphs)

    # 3. Shuffle non-needle paragraphs deterministically and re-insert
    #    the needle at the same proportional position.
    rng = random.Random(seed)
    others = list(padding_paragraphs)
    rng.shuffle(others)
    target_idx = _resolve_position_index(position, len(others))
    shuffled_paragraphs = others[:target_idx] + [needle_paragraph] + others[target_idx:]
    shuffled = "\n\n".join(shuffled_paragraphs)

    relative_offset = (
        0.0
        if position == "start"
        else 1.0
        if position == "end"
        else 0.5
    )

    return HaystackPair(
        structured=structured,
        shuffled=shuffled,
        target_tokens=target_tokens,
        actual_tokens=_approx_tokens(structured),
        needle_position=position,
        needle_relative_offset=relative_offset,
    )


def main() -> None:
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Inspect a haystack pair built around the first needle.")
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--target-tokens", type=int, default=5_000)
    parser.add_argument("--position", choices=_VALID_POSITIONS, default="middle")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    from .needles import extract_needles

    needles = extract_needles(args.vault, limit=1)
    if not needles:
        raise SystemExit("no needles extractable from vault")
    pair = build_pair(
        args.vault,
        needles[0],
        target_tokens=args.target_tokens,
        position=args.position,
        seed=args.seed,
    )
    print(json.dumps(
        {
            "needle": needles[0].text,
            "needle_position": pair.needle_position,
            "needle_relative_offset": pair.needle_relative_offset,
            "target_tokens": pair.target_tokens,
            "actual_tokens": pair.actual_tokens,
            "structured_first_500": pair.structured[:500],
            "shuffled_first_500": pair.shuffled[:500],
        },
        indent=2,
    ))


if __name__ == "__main__":
    main()
