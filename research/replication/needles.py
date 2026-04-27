"""Needle extraction for the Chroma replication.

A *needle* is a fact-bearing one-line claim that:
  1. appears verbatim in exactly one file of the vault, and
  2. is reasonably unambiguous (not generic boilerplate, not a heading).

For v0.1 the extractor is rule-based: it scans Markdown sentences and
keeps those that contain a proper noun, a number, or a quoted phrase,
and that occur exactly once across the vault. This is intentionally
crude — the goal is to produce reproducible needles on small sample
vaults, not to be the final extractor for v1.

Replace with an LLM-extracted needle set when scaling to MarkdownMemBench v1.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

# Match a sentence: anything ending in . ! or ? followed by whitespace or EOL.
_SENT_RE = re.compile(r"(?<=[.!?])\s+")
# Heuristic markers of a needle-worthy sentence.
_PROPER_NOUN_RE = re.compile(r"\b[A-Z][a-zA-Z]{2,}\b")
_NUMBER_RE = re.compile(r"\b\d{2,}\b")
_QUOTE_RE = re.compile(r"['\"][^'\"\n]{4,}['\"]")
# Reject sentences that look like boilerplate.
_BOILERPLATE_RE = re.compile(
    r"^(see also|notes?|todo|tbd|---|table of contents|references|next steps?)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Needle:
    text: str
    source_path: str
    source_md5: str

    def question(self) -> str:
        return f"Verbatim, what does the vault say in the sentence that ends '{self.text[-40:].strip()}'?"

    def answer(self) -> str:
        return self.text


def extract_needles(vault_root: Path, *, limit: int = 8) -> list[Needle]:
    """Return up to `limit` needles drawn deterministically from `vault_root`."""
    files = sorted(p for p in vault_root.rglob("*.md") if "/.mnemoscope/" not in str(p))
    sentences_by_file: dict[Path, list[str]] = {}
    sentence_counts: dict[str, int] = {}

    for f in files:
        text = f.read_text(encoding="utf-8")
        sents = [_clean(s) for s in _SENT_RE.split(text)]
        sents = [s for s in sents if _is_needle_candidate(s)]
        sentences_by_file[f] = sents
        for s in sents:
            sentence_counts[s] = sentence_counts.get(s, 0) + 1

    needles: list[Needle] = []
    for f, sents in sentences_by_file.items():
        for s in sents:
            if sentence_counts[s] != 1:
                continue
            md5 = hashlib.md5(s.encode("utf-8")).hexdigest()[:8]
            needles.append(Needle(text=s, source_path=str(f.relative_to(vault_root)), source_md5=md5))
            if len(needles) >= limit:
                return needles
    return needles


def _clean(s: str) -> str:
    return s.strip().replace("\n", " ")


def _is_needle_candidate(s: str) -> bool:
    if len(s) < 40 or len(s) > 220:
        return False
    if s.startswith("#"):  # heading
        return False
    if _BOILERPLATE_RE.match(s):
        return False
    if not (_PROPER_NOUN_RE.search(s) or _NUMBER_RE.search(s) or _QUOTE_RE.search(s)):
        return False
    return True


def main() -> None:
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Extract needles from a vault.")
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    needles = extract_needles(args.vault, limit=args.limit)
    payload = [{"text": n.text, "source_path": n.source_path, "source_md5": n.source_md5} for n in needles]
    if args.out:
        args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"wrote {len(needles)} needles to {args.out}")
    else:
        print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
