"""Needle extraction tests."""
from __future__ import annotations

from pathlib import Path

from replication.needles import extract_needles


def _write_vault(root: Path) -> None:
    (root / "chapters").mkdir(parents=True, exist_ok=True)
    (root / "chapters" / "01.md").write_text(
        "Maria moved from Madrid to Lisbon in March 2023 to finish her novel. "
        "The city was unfamiliar but inexpensive in those years.\n\n"
        "She rented an apartment with a typewriter that the previous tenant had abandoned. "
        "Just notes, nothing major.\n",
        encoding="utf-8",
    )
    (root / "chapters" / "02.md").write_text(
        "Her sister Anna stayed in Madrid until November 2024 with three cats and a parrot named Felix. "
        "They wrote letters once a week, never on Sundays.\n\n"
        "Just notes, nothing major.\n",
        encoding="utf-8",
    )


def test_extract_needles_finds_unique_factual_sentences(tmp_path: Path) -> None:
    _write_vault(tmp_path)
    needles = extract_needles(tmp_path, limit=8)

    texts = [n.text for n in needles]

    # Sentences with proper noun + number that occur exactly once survive.
    assert any("Lisbon" in t and "2023" in t for t in texts)
    assert any("Madrid" in t and "November" in t for t in texts)

    # Boilerplate sentence ("Just notes, nothing major.") repeats across files
    # and must therefore be filtered out.
    assert all("Just notes" not in t for t in texts)


def test_extract_needles_respects_limit(tmp_path: Path) -> None:
    _write_vault(tmp_path)
    assert len(extract_needles(tmp_path, limit=1)) == 1


def test_extract_needles_md5_is_stable(tmp_path: Path) -> None:
    _write_vault(tmp_path)
    a = extract_needles(tmp_path, limit=8)
    b = extract_needles(tmp_path, limit=8)
    assert [n.source_md5 for n in a] == [n.source_md5 for n in b]
