import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRotScore } from "./rot-score.js";
import type { VaultSignature } from "./signatures.js";

const baseSig: VaultSignature = {
  rootPath: "/tmp/test-vault",
  noteCount: 0,
  totalChars: 0,
  approxTokens: 0,
  notes: [],
  collectedAt: new Date().toISOString(),
};

test("empty vault scores low", () => {
  const result = computeRotScore(baseSig);
  assert.equal(result.score, 0);
  assert.equal(result.baselineModel, "v0-heuristic");
});

test("very large vault scores high on tokenVolume", () => {
  const sig: VaultSignature = {
    ...baseSig,
    approxTokens: 250_000,
    notes: Array.from({ length: 50 }, (_, i) => ({
      relPath: `note-${i}.md`,
      chars: 20_000,
      approxTokens: 5_000,
      ageDays: 30,
      daysSinceModified: 30,
      outboundLinks: 5,
      headingCount: 10,
    })),
    noteCount: 50,
    totalChars: 1_000_000,
  };
  const result = computeRotScore(sig);
  assert.ok(result.factors.tokenVolume >= 99, `expected high tokenVolume, got ${result.factors.tokenVolume}`);
  assert.ok(result.score >= 30);
});

test("dominantFactor names the highest-pressure factor", () => {
  const sig: VaultSignature = {
    ...baseSig,
    approxTokens: 1_000,
    notes: Array.from({ length: 100 }, (_, i) => ({
      relPath: `tiny-${i}.md`,
      chars: 50,
      approxTokens: 12,
      ageDays: 5,
      daysSinceModified: 1,
      outboundLinks: 0,
      headingCount: 0,
    })),
    noteCount: 100,
    totalChars: 5000,
  };
  const result = computeRotScore(sig);
  assert.equal(result.dominantFactor, "distractorDensity");
});
