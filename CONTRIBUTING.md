# Contributing to Mnemoscope

Thanks for considering a contribution. The project is in early scaffolding, so the most useful contributions today are conversational, not code-heavy.

## Before writing code

1. **Open an issue first** describing what you want to do, what use case it solves, and what alternatives you considered.
2. **Read the [README](README.md)** — especially the *Three contribution axes* and *Voisins* sections — so we don't duplicate work that already lives elsewhere in the ecosystem.

## Code style

- TypeScript packages: target Node 22+, strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Avoid runtime dependencies whenever possible. The MCP server should boot quickly on cold install.
- No comments that simply restate what the code does. Comments explain *why* — invariants, trade-offs, references to papers.

## License

By submitting a PR you agree to license your contribution under Apache-2.0, the project's license.

## Researchers

If you're working on agent memory at Letta, Chroma, Mem0, Cognee, OSU-NLP, Snap Research, or any related lab and you see overlap or complementarity with the *Predictive Context Rot* or *MarkdownMemBench* axes — please open an issue or reach out. The project is explicitly designed to invite this collaboration.
