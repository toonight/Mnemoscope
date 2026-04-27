"""Haystack builder tests — redaction, position sweep, determinism."""
from __future__ import annotations

from pathlib import Path

import pytest

from replication.haystack import (
    _NEEDLE_MARKER,
    _PARAGRAPH_RE,
    _REDACTED_MARKER,
    build_pair,
)
from replication.needles import Needle, extract_needles


def _write_vault(root: Path) -> None:
    (root / "chapters").mkdir(parents=True, exist_ok=True)
    (root / "chapters" / "01.md").write_text(
        "Maria moved to Lisbon in March 2023. She rented an apartment with a typewriter.\n\n"
        "The cat she adopted was named Olivia, after a friend who had visited from Madrid.\n",
        encoding="utf-8",
    )
    (root / "chapters" / "02.md").write_text(
        "Her sister Anna stayed in Madrid until November 2024. They wrote letters every week.\n\n"
        "The novel had eleven chapters and a working title that nobody liked.\n",
        encoding="utf-8",
    )


def _first_needle(tmp_path: Path) -> Needle:
    _write_vault(tmp_path)
    needles = extract_needles(tmp_path, limit=1)
    assert needles, "fixture vault yielded no needles"
    return needles[0]


@pytest.mark.parametrize("position", ["start", "middle", "end"])
def test_needle_appears_exactly_once_at_position(tmp_path: Path, position: str) -> None:
    needle = _first_needle(tmp_path)
    pair = build_pair(tmp_path, needle, target_tokens=2_000, position=position)

    for hay in (pair.structured, pair.shuffled):
        assert hay.count(needle.text) == 1, "needle must occur exactly once"
        assert hay.count(_NEEDLE_MARKER) == 1, "exactly one marked needle paragraph"
        # The natural occurrence must be redacted, never appearing as raw text.
        assert _REDACTED_MARKER in hay


@pytest.mark.parametrize("position,frac_low,frac_high", [
    ("start", 0.0, 0.10),
    ("middle", 0.40, 0.60),
    ("end", 0.90, 1.0),
])
def test_needle_position_band(tmp_path: Path, position: str, frac_low: float, frac_high: float) -> None:
    """The needle marker should land in the requested third of the haystack."""
    needle = _first_needle(tmp_path)
    pair = build_pair(tmp_path, needle, target_tokens=4_000, position=position)

    paragraphs = _PARAGRAPH_RE.split(pair.structured)
    needle_idx = next(i for i, p in enumerate(paragraphs) if _NEEDLE_MARKER in p)
    frac = needle_idx / max(1, len(paragraphs) - 1)
    assert frac_low <= frac <= frac_high, (
        f"position={position}: needle idx fraction {frac:.2f} not in [{frac_low}, {frac_high}]"
    )


def test_shuffled_is_deterministic_given_seed(tmp_path: Path) -> None:
    needle = _first_needle(tmp_path)
    a = build_pair(tmp_path, needle, target_tokens=2_000, position="middle", seed=42)
    b = build_pair(tmp_path, needle, target_tokens=2_000, position="middle", seed=42)
    assert a.shuffled == b.shuffled


def test_shuffled_and_structured_share_same_paragraph_set(tmp_path: Path) -> None:
    """Shuffling must permute paragraphs, not modify their content."""
    needle = _first_needle(tmp_path)
    pair = build_pair(tmp_path, needle, target_tokens=3_000, position="middle")
    s_paragraphs = sorted(p.strip() for p in _PARAGRAPH_RE.split(pair.structured) if p.strip())
    h_paragraphs = sorted(p.strip() for p in _PARAGRAPH_RE.split(pair.shuffled) if p.strip())
    assert s_paragraphs == h_paragraphs


def test_invalid_position_rejected(tmp_path: Path) -> None:
    needle = _first_needle(tmp_path)
    with pytest.raises(ValueError):
        build_pair(tmp_path, needle, target_tokens=2_000, position="elsewhere")
