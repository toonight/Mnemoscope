import type { VaultSignature, NoteSignature } from "./signatures.js";

export type { VaultSignature };

/**
 * Predictive context-rot risk score for a vault. The score is a heuristic
 * estimate (0-100) of the likelihood that injecting this corpus into a long-context
 * LLM will trigger meaningful accuracy loss, derived from structural signatures
 * of the corpus (token volume, redundancy proxies, link topology, freshness).
 *
 * Future versions will replace the heuristic blend with a calibrated classifier
 * trained on LongMemEval / LoCoMo / MarkdownMemBench, distributed as ONNX.
 *
 * The current weights are deliberately simple and documented here so that the
 * downstream calibration paper can compare against this baseline.
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

const TOKEN_BUDGET_DEGRADATION_START = 50_000;
const TOKEN_BUDGET_DEGRADATION_HARD = 200_000;

export function computeRotScore(sig: VaultSignature): RotScore {
  const factors = {
    tokenVolume: tokenVolumeFactor(sig.approxTokens),
    semanticRedundancy: semanticRedundancyFactor(sig.notes),
    distractorDensity: distractorDensityFactor(sig.notes),
    structuralCoherence: structuralCoherenceFactor(sig.notes),
    freshnessSpread: freshnessSpreadFactor(sig.notes),
  };

  // Equal-weighted v0 blend. Calibration paper will fit per-factor weights.
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

function tokenVolumeFactor(totalTokens: number): number {
  if (totalTokens <= TOKEN_BUDGET_DEGRADATION_START) return clamp((totalTokens / TOKEN_BUDGET_DEGRADATION_START) * 30);
  const span = TOKEN_BUDGET_DEGRADATION_HARD - TOKEN_BUDGET_DEGRADATION_START;
  const overflow = Math.min(totalTokens - TOKEN_BUDGET_DEGRADATION_START, span);
  return clamp(30 + (overflow / span) * 70);
}

function semanticRedundancyFactor(notes: NoteSignature[]): number {
  if (notes.length < 2) return 0;
  // Heuristic v0: redundancy proxy = how much of the corpus is concentrated in a few large notes.
  // High concentration suggests duplicated themes; low concentration suggests diversity. Real
  // redundancy will use embedding similarity.
  const totalChars = notes.reduce((s, n) => s + n.chars, 0);
  if (totalChars === 0) return 0;
  const sorted = [...notes].sort((a, b) => b.chars - a.chars);
  const topShare = sorted.slice(0, Math.max(1, Math.floor(notes.length * 0.1))).reduce((s, n) => s + n.chars, 0);
  const ratio = topShare / totalChars;
  return clamp((ratio - 0.5) * 200);
}

function distractorDensityFactor(notes: NoteSignature[]): number {
  // Heuristic v0: many small notes with low link density act as distractors during retrieval.
  if (notes.length === 0) return 0;
  const smallNotes = notes.filter((n) => n.approxTokens > 0 && n.approxTokens < 200);
  return clamp((smallNotes.length / notes.length) * 100);
}

function structuralCoherenceFactor(notes: NoteSignature[]): number {
  // Counter-intuitive: Chroma 2025 showed structured haystacks degrade more than shuffled ones.
  // We treat *very high* link density and *very high* heading density as a risk factor, not a virtue.
  if (notes.length === 0) return 0;
  const avgLinks = notes.reduce((s, n) => s + n.outboundLinks, 0) / notes.length;
  const avgHeadings = notes.reduce((s, n) => s + n.headingCount, 0) / notes.length;
  return clamp(Math.min(100, avgLinks * 5 + avgHeadings * 3));
}

function freshnessSpreadFactor(notes: NoteSignature[]): number {
  if (notes.length === 0) return 0;
  // Heuristic v0: a vault where 90%+ notes are stale (>180 days) carries higher rot risk
  // because the "working layer" is too small to shield retrieval from old material.
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
