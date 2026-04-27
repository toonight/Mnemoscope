"""Pytest config for the research sub-project tests.

The tests live under `research/tests/` and import sibling packages
(`replication`, `classifier`) using their package names. We add the
research root to `sys.path` so that works regardless of where pytest
is invoked from.
"""
from __future__ import annotations

import sys
from pathlib import Path

_RESEARCH_ROOT = Path(__file__).resolve().parent.parent
if str(_RESEARCH_ROOT) not in sys.path:
    sys.path.insert(0, str(_RESEARCH_ROOT))
