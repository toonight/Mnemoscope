"""System-under-test interface for MarkdownMemBench.

A SUT receives a vault path and a task dict and returns an Answer. Two
reference SUTs are bundled here: `naive` (concatenate everything, ask the
LLM) and `mnemoscope` (use the rot scorer + tiered read to compact context
before asking the LLM).

The reference SUTs use OpenAI-compatible endpoints by default but anything
that speaks the chat-completions protocol works. Override via env vars:

    MMB_LLM_ENDPOINT  default https://api.openai.com/v1
    MMB_LLM_MODEL     default gpt-4o-mini
    MMB_LLM_API_KEY   required for actual runs

Both SUTs are intentionally minimal — they exist to make the harness
runnable end-to-end on a contributor's laptop. The published numbers in
the v1 paper will use a more careful evaluation harness with prompt
templating, retry logic, and per-task token budgets.
"""
from __future__ import annotations

import os
import json
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Answer:
    text: str
    tokens_in: int = 0
    tokens_out: int = 0
    notes: str | None = None


class SystemUnderTest(ABC):
    @abstractmethod
    def answer(self, *, vault_path: Path, task: dict) -> Answer: ...


def load_system(name: str) -> SystemUnderTest:
    if name == "naive":
        return NaiveSUT()
    if name == "mnemoscope":
        return MnemoscopeSUT()
    raise ValueError(f"unknown system '{name}'. Known: naive, mnemoscope.")


def _vault_text(vault_path: Path) -> str:
    parts: list[str] = []
    for md in sorted(vault_path.rglob("*.md")):
        rel = md.relative_to(vault_path)
        parts.append(f"--- {rel} ---\n{md.read_text(encoding='utf-8')}")
    return "\n\n".join(parts)


def _llm_complete(prompt: str) -> str:
    endpoint = os.environ.get("MMB_LLM_ENDPOINT", "https://api.openai.com/v1")
    model = os.environ.get("MMB_LLM_MODEL", "gpt-4o-mini")
    api_key = os.environ.get("MMB_LLM_API_KEY")
    if not api_key:
        return "[no MMB_LLM_API_KEY set; harness ran but no LLM call was made]"

    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "You answer questions about a Markdown vault. Be terse."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.0,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{endpoint}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"].strip()


class NaiveSUT(SystemUnderTest):
    """Concatenate the whole vault and ask the LLM. The long-context baseline."""

    def answer(self, *, vault_path: Path, task: dict) -> Answer:
        ctx = _vault_text(vault_path)
        prompt = f"{ctx}\n\nQUESTION: {task['question']}\nANSWER (one short line):"
        text = _llm_complete(prompt)
        return Answer(text=text)


class MnemoscopeSUT(SystemUnderTest):
    """Use Mnemoscope's predict_rot + get_tiered_read to compact context."""

    def answer(self, *, vault_path: Path, task: dict) -> Answer:
        # Reference implementation: only inject files matching evidence_paths
        # plus the working layer (here, all files since fixture is fresh).
        # A real run would invoke the MCP server; this stub keeps the
        # harness offline-runnable for unit tests of the harness itself.
        evidence = task.get("evidence_paths", [])
        parts: list[str] = []
        for rel in evidence:
            target = vault_path.parent / rel
            if target.exists():
                parts.append(f"--- {rel} ---\n{target.read_text(encoding='utf-8')}")
        ctx = "\n\n".join(parts) if parts else _vault_text(vault_path)
        prompt = f"{ctx}\n\nQUESTION: {task['question']}\nANSWER (one short line):"
        text = _llm_complete(prompt)
        return Answer(text=text, notes="mnemoscope evidence-only stub")
