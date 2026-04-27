import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRotScore,
  tokenVolumeFactor,
  semanticRedundancyFactor,
  distractorDensityFactor,
  structuralCoherenceFactor,
  freshnessSpreadFactor,
} from "./rot-score.js";
import type { VaultSignature, NoteSignature } from "./signatures.js";

const baseSig: VaultSignature = {
  rootPath: "/tmp/test-vault",
  noteCount: 0,
  totalChars: 0,
  approxTokens: 0,
  notes: [],
  collectedAt: new Date().toISOString(),
};

function note(over: Partial<NoteSignature> = {}): NoteSignature {
  return {
    relPath: "n.md",
    chars: 1000,
    approxTokens: 250,
    ageDays: 30,
    daysSinceModified: 30,
    outboundLinks: 0,
    headingCount: 0,
    ...over,
  };
}

// -- top-level computeRotScore -----------------------------------------------

test("empty vault scores zero", () => {
  const result = computeRotScore(baseSig);
  assert.equal(result.score, 0);
  assert.equal(result.baselineModel, "v0-heuristic");
});

test("very large vault scores high on tokenVolume", () => {
  const sig: VaultSignature = {
    ...baseSig,
    approxTokens: 250_000,
    notes: Array.from({ length: 50 }, (_, i) => note({ relPath: `note-${i}.md`, chars: 20_000, approxTokens: 5_000 })),
    noteCount: 50,
    totalChars: 1_000_000,
  };
  const result = computeRotScore(sig);
  assert.equal(result.factors.tokenVolume, 100);
  // One factor at 100 with the others at 0 gives (100+0+0+0+0)/5 = 20 under
  // the equal-weighted v0 blend. The calibrated classifier will reweight.
  assert.ok(result.score >= 20);
  assert.equal(result.dominantFactor, "tokenVolume");
});

test("dominantFactor names the highest-pressure factor", () => {
  const sig: VaultSignature = {
    ...baseSig,
    approxTokens: 1_000,
    notes: Array.from({ length: 100 }, (_, i) => note({ relPath: `tiny-${i}.md`, chars: 50, approxTokens: 12, daysSinceModified: 1 })),
    noteCount: 100,
    totalChars: 5000,
  };
  const result = computeRotScore(sig);
  assert.equal(result.dominantFactor, "distractorDensity");
});

test("topRiskNotes orders by approxTokens with stale and hub bonuses", () => {
  const sig: VaultSignature = {
    ...baseSig,
    approxTokens: 30_000,
    notes: [
      note({ relPath: "tiny.md", approxTokens: 50 }),
      note({ relPath: "stale.md", approxTokens: 100, daysSinceModified: 400 }),
      note({ relPath: "hub.md", approxTokens: 100, outboundLinks: 80 }),
      note({ relPath: "huge.md", approxTokens: 9000 }),
    ],
    noteCount: 4,
    totalChars: 60_000,
  };
  const result = computeRotScore(sig);
  assert.equal(result.topRiskNotes[0]!.relPath, "huge.md");
  // Both stale.md and hub.md should rank above tiny.md (which has the lowest risk).
  const tinyIdx = result.topRiskNotes.findIndex((n) => n.relPath === "tiny.md");
  const staleIdx = result.topRiskNotes.findIndex((n) => n.relPath === "stale.md");
  const hubIdx = result.topRiskNotes.findIndex((n) => n.relPath === "hub.md");
  assert.ok(staleIdx < tinyIdx);
  assert.ok(hubIdx < tinyIdx);
});

// -- per-factor unit tests ----------------------------------------------------

test("tokenVolumeFactor: 0 → 0, 50K → 30, 200K → 100, 500K → 100", () => {
  assert.equal(tokenVolumeFactor(0), 0);
  assert.equal(tokenVolumeFactor(50_000), 30);
  assert.equal(tokenVolumeFactor(200_000), 100);
  assert.equal(tokenVolumeFactor(500_000), 100);
});

test("tokenVolumeFactor: 25K is half the linear ramp (≈15)", () => {
  assert.equal(Math.round(tokenVolumeFactor(25_000)), 15);
});

test("semanticRedundancyFactor: returns 0 below 50% concentration", () => {
  // Top 10% (1 note out of 10) holds ~10% of chars → ratio 0.1 → factor 0.
  const notes: NoteSignature[] = Array.from({ length: 10 }, (_, i) => note({ relPath: `n${i}.md`, chars: 1000, approxTokens: 250 }));
  assert.equal(semanticRedundancyFactor(notes), 0);
});

test("semanticRedundancyFactor: ramps to 100 at full concentration", () => {
  const notes: NoteSignature[] = [
    note({ relPath: "huge.md", chars: 1_000_000, approxTokens: 250_000 }),
    ...Array.from({ length: 9 }, (_, i) => note({ relPath: `tiny-${i}.md`, chars: 1, approxTokens: 1 })),
  ];
  assert.ok(semanticRedundancyFactor(notes) > 99);
});

test("semanticRedundancyFactor: empty / single-note vaults score 0", () => {
  assert.equal(semanticRedundancyFactor([]), 0);
  assert.equal(semanticRedundancyFactor([note()]), 0);
});

test("distractorDensityFactor: all small notes → 100, all big → 0", () => {
  const small = Array.from({ length: 10 }, (_, i) => note({ relPath: `s${i}.md`, approxTokens: 50 }));
  const big = Array.from({ length: 10 }, (_, i) => note({ relPath: `b${i}.md`, approxTokens: 1000 }));
  assert.equal(distractorDensityFactor(small), 100);
  assert.equal(distractorDensityFactor(big), 0);
});

test("distractorDensityFactor: half small → 50", () => {
  const mixed = [
    ...Array.from({ length: 5 }, (_, i) => note({ relPath: `s${i}.md`, approxTokens: 50 })),
    ...Array.from({ length: 5 }, (_, i) => note({ relPath: `b${i}.md`, approxTokens: 1000 })),
  ];
  assert.equal(distractorDensityFactor(mixed), 50);
});

test("structuralCoherenceFactor: ramps with avg link/heading density", () => {
  const flat = [note({ outboundLinks: 0, headingCount: 0 })];
  assert.equal(structuralCoherenceFactor(flat), 0);

  const dense = Array.from({ length: 5 }, () => note({ outboundLinks: 20, headingCount: 10 }));
  assert.equal(structuralCoherenceFactor(dense), 100);
});

test("freshnessSpreadFactor: all stale → 100, all fresh → 0", () => {
  const stale = Array.from({ length: 10 }, (_, i) => note({ relPath: `s${i}.md`, daysSinceModified: 365 }));
  const fresh = Array.from({ length: 10 }, (_, i) => note({ relPath: `f${i}.md`, daysSinceModified: 1 }));
  assert.equal(freshnessSpreadFactor(stale), 100);
  assert.equal(freshnessSpreadFactor(fresh), 0);
});

test("freshnessSpreadFactor: 30% stale → 30", () => {
  const mixed = [
    ...Array.from({ length: 3 }, (_, i) => note({ relPath: `s${i}.md`, daysSinceModified: 200 })),
    ...Array.from({ length: 7 }, (_, i) => note({ relPath: `f${i}.md`, daysSinceModified: 30 })),
  ];
  assert.equal(freshnessSpreadFactor(mixed), 30);
});
