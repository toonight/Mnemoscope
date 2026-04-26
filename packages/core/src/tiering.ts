import type { NoteSignature, VaultSignature } from "./signatures.js";

export type TierLayer = "working" | "episodic" | "semantic";

export type TieredVault = {
  working: NoteSignature[];
  episodic: NoteSignature[];
  semantic: NoteSignature[];
  policy: TieringPolicy;
};

export type TieringPolicy = {
  workingMaxAgeDays: number;
  episodicMaxAgeDays: number;
};

const DEFAULT_POLICY: TieringPolicy = {
  workingMaxAgeDays: 7,
  episodicMaxAgeDays: 90,
};

/**
 * Splits a vault into a 3-layer hierarchy inspired by the working/episodic/semantic
 * decomposition that the 2025-2026 agent-memory science (Letta sleep-time, GAM dual-agent,
 * Karpathy LLM Wiki) keeps converging on. Today this is a freshness-only split; future
 * versions will use access frequency, semantic centrality, and explicit user pinning.
 */
export function tierVault(sig: VaultSignature, policy: TieringPolicy = DEFAULT_POLICY): TieredVault {
  const working: NoteSignature[] = [];
  const episodic: NoteSignature[] = [];
  const semantic: NoteSignature[] = [];

  for (const note of sig.notes) {
    if (note.daysSinceModified <= policy.workingMaxAgeDays) {
      working.push(note);
    } else if (note.daysSinceModified <= policy.episodicMaxAgeDays) {
      episodic.push(note);
    } else {
      semantic.push(note);
    }
  }

  return { working, episodic, semantic, policy };
}
