import type { VaultSignature, NoteSignature } from "./signatures.js";

export type { VaultSignature };

/**
 * Predictive context-rot risk score for a vault.
 *
 * The score is a heuristic estimate (0–100) of the probability that
 * injecting this corpus into a long-context LLM will trigger meaningful
 * accuracy loss. It is derived from structural signatures of the corpus
 * (token volume, redundancy proxies, link topology, freshness).
 *
 * The current implementation is the **v0 heuristic baseline**. It is
 * uncalibrated by design: a future calibrated classifier (trained on
 * LongMemEval / LoCoMo / MarkdownMemBench, exported to ONNX) will replace
 * the blend below, and the v0 heuristic will become the published baseline
 * to compare against.
 *
 * The thresholds and formulas are documented inline so that the calibration
 * paper, and any reviewer of the published baseline, can audit each choice.
 */
export type RotScore = {
  score: number;
  factors: {
    tokenVolume: number;
    semanticRedundancy: number;
    distractorDensity: number;
    structuralCoherence: number;
    freshnessSpread: number;
  };
  dominantFactor: keyof RotScore["factors"];
  topRiskNotes: Array<{ relPath: string; reason: string; approxTokens: number }>;
  baselineModel: "v0-heuristic";
};

/**
 * Where the degradation curve starts to bend, in approximate tokens.
 * Calibrated against Chroma's *Context Rot* (July 2025): in their study of
 * 18 frontier models, accuracy starts to drop noticeably between 10–50K
 * tokens of context — even on the best 200K-window models. We pick 50K as
 * the start of the linear penalty zone.
 *
 * @see https://www.trychroma.com/research/context-rot
 */
const TOKEN_BUDGET_DEGRADATION_START = 50_000;

/**
 * Hard upper bound where degradation is severe across all 18 models in
 * Chroma's study; beyond this we cap the volume factor at 100.
 */
const TOKEN_BUDGET_DEGRADATION_HARD = 200_000;

export function computeRotScore(sig: VaultSignature): RotScore {
  const factors = {
    tokenVolume: tokenVolumeFactor(sig.approxTokens),
    semanticRedundancy: semanticRedundancyFactor(sig.notes),
    distractorDensity: distractorDensityFactor(sig.notes),
    structuralCoherence: structuralCoherenceFactor(sig.notes),
    freshnessSpread: freshnessSpreadFactor(sig.notes),
  };

  // Equal-weighted v0 blend. The calibration paper will fit per-factor
  // weights against measured accuracy loss on LongMemEval / LoCoMo and
  // any vault-native bench (MarkdownMemBench, planned).
  const score = Math.round(
    (factors.tokenVolume +
      factors.semanticRedundancy +
      factors.distractorDensity +
      factors.structuralCoherence +
      factors.freshnessSpread) /
      5,
  );

  const dominantFactor = (Object.entries(factors) as Array<[keyof RotScore["factors"], number]>).reduce((acc, cur) =>
    cur[1] > acc[1] ? cur : acc,
  )[0];

  const topRiskNotes = sig.notes
    .map((n) => ({
      relPath: n.relPath,
      approxTokens: n.approxTokens,
      reason: noteReason(n),
      _risk: noteRisk(n),
    }))
    .sort((a, b) => b._risk - a._risk)
    .slice(0, 5)
    .map(({ _risk, ...rest }) => rest);

  return { score, factors, dominantFactor, topRiskNotes, baselineModel: "v0-heuristic" };
}

/**
 * Linear ramp from 0 at empty corpus to 30 at 50K tokens (the start of the
 * Chroma degradation zone), then a steeper ramp from 30 to 100 between 50K
 * and 200K tokens. Past 200K, capped at 100.
 *
 * The piecewise shape encodes the empirical observation that the *first*
 * 50K tokens are mostly free, but every additional 30K beyond that is
 * roughly equivalent to the entire pre-50K budget in terms of risk.
 */
export function tokenVolumeFactor(totalTokens: number): number {
  if (totalTokens <= 0) return 0;
  if (totalTokens <= TOKEN_BUDGET_DEGRADATION_START) {
    return clamp((totalTokens / TOKEN_BUDGET_DEGRADATION_START) * 30);
  }
  const span = TOKEN_BUDGET_DEGRADATION_HARD - TOKEN_BUDGET_DEGRADATION_START;
  const overflow = Math.min(totalTokens - TOKEN_BUDGET_DEGRADATION_START, span);
  return clamp(30 + (overflow / span) * 70);
}

/**
 * Heuristic v0: redundancy proxy = how much of the corpus is concentrated
 * in the top 10% of largest notes. High concentration suggests duplicated
 * themes (the same content rephrased in many places) which acts as
 * distractor mass for retrieval.
 *
 * Real redundancy will use embedding similarity between notes; that
 * implementation is gated behind the calibrated classifier and is not in
 * v0 to keep `core` dependency-free.
 *
 * Below 0.5 concentration ratio we score 0; above, we ramp linearly to
 * 100 at full concentration.
 */
export function semanticRedundancyFactor(notes: NoteSignature[]): number {
  if (notes.length < 2) return 0;
  const totalChars = notes.reduce((s, n) => s + n.chars, 0);
  if (totalChars === 0) return 0;
  const sorted = [...notes].sort((a, b) => b.chars - a.chars);
  const topCount = Math.max(1, Math.floor(notes.length * 0.1));
  const topShare = sorted.slice(0, topCount).reduce((s, n) => s + n.chars, 0);
  const ratio = topShare / totalChars;
  return clamp((ratio - 0.5) * 200);
}

/**
 * Heuristic v0: many small notes (< 200 tokens) act as distractors during
 * retrieval — they are too short to be authoritative but numerous enough
 * to dilute attention. Liu et al. 2023 (*Lost in the Middle*) and Chroma
 * 2025 both report that distractor density matters more than total volume
 * for some failure modes.
 *
 * @see https://arxiv.org/abs/2307.03172
 * @see https://www.trychroma.com/research/context-rot
 */
export function distractorDensityFactor(notes: NoteSignature[]): number {
  if (notes.length === 0) return 0;
  const smallNotes = notes.filter((n) => n.approxTokens > 0 && n.approxTokens < 200);
  return clamp((smallNotes.length / notes.length) * 100);
}

/**
 * Counter-intuitive v0: Chroma 2025 showed that *structured* haystacks
 * with strong narrative coherence underperform shuffled haystacks on NIAH.
 * High link density and high heading density are proxies for narrative
 * structure, so we treat them as a risk factor — not a virtue.
 *
 * The exact relationship is not yet quantified for vaults; this factor is
 * one of the most important targets of the planned MarkdownMemBench
 * replication of Chroma's finding.
 *
 * @see https://www.trychroma.com/research/context-rot
 */
export function structuralCoherenceFactor(notes: NoteSignature[]): number {
  if (notes.length === 0) return 0;
  const avgLinks = notes.reduce((s, n) => s + n.outboundLinks, 0) / notes.length;
  const avgHeadings = notes.reduce((s, n) => s + n.headingCount, 0) / notes.length;
  return clamp(Math.min(100, avgLinks * 5 + avgHeadings * 3));
}

/**
 * Heuristic v0: a vault where 90%+ of notes are stale (last modified >180
 * days ago) carries higher rot risk because the working layer is too
 * small to shield retrieval from old material — the ratio of recent,
 * topically-relevant notes to background material is too low. Inspired
 * by Letta's filesystem result and the working / episodic / semantic
 * memory split that the 2025–2026 agent-memory literature converges on.
 *
 * @see https://www.letta.com/blog/benchmarking-ai-agent-memory
 */
export function freshnessSpreadFactor(notes: NoteSignature[]): number {
  if (notes.length === 0) return 0;
  const stale = notes.filter((n) => n.daysSinceModified > 180).length;
  return clamp((stale / notes.length) * 100);
}

function noteRisk(n: NoteSignature): number {
  return n.approxTokens + (n.daysSinceModified > 365 ? 200 : 0) + (n.outboundLinks > 50 ? 100 : 0);
}

function noteReason(n: NoteSignature): string {
  const reasons: string[] = [];
  if (n.approxTokens > 8000) reasons.push("very large note");
  else if (n.approxTokens > 2000) reasons.push("large note");
  if (n.daysSinceModified > 365) reasons.push("stale (>1y)");
  if (n.outboundLinks > 50) reasons.push("hub note (>50 outbound links)");
  if (reasons.length === 0) reasons.push("baseline");
  return reasons.join(", ");
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
