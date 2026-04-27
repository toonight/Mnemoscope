import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal } from "./journal.js";

function freshJournal() {
  const dir = mkdtempSync(join(tmpdir(), "mnemoscope-journal-"));
  return { dir, path: join(dir, ".mnemoscope", "journal.jsonl") };
}

test("records and verifies a write entry", async () => {
  const { path } = freshJournal();
  const journal = await Journal.open(path, "session-1");
  const entry = await journal.record("write", "/v/note.md", "before", "after");
  assert.equal(entry.op, "write");
  assert.equal(entry.bytesBefore, 6);
  assert.equal(entry.bytesAfter, 5);
  assert.ok(entry.sig.length > 0, "signature must be present");
  const verified = await journal.verifyAll();
  assert.equal(verified.length, 1);
  assert.equal(verified[0]!.valid, true);
});

test("detects tampering with the path field", async () => {
  const { path } = freshJournal();
  const journal = await Journal.open(path, "session-1");
  await journal.record("write", "/v/original.md", "before", "after");
  const raw = readFileSync(path, "utf8");
  const tampered = raw.replace("/v/original.md", "/v/forged.md");
  writeFileSync(path, tampered, "utf8");
  const verified = await journal.verifyAll();
  assert.equal(verified[0]!.valid, false);
});

test("detects tampering with the bytesAfter field", async () => {
  const { path } = freshJournal();
  const journal = await Journal.open(path, "session-1");
  await journal.record("write", "/v/note.md", "hello", "world");
  const raw = readFileSync(path, "utf8");
  const tampered = raw.replace('"bytesAfter":5', '"bytesAfter":99999');
  writeFileSync(path, tampered, "utf8");
  const verified = await journal.verifyAll();
  assert.equal(verified[0]!.valid, false);
});

test("flags entries signed by a different keypair", async () => {
  const { dir, path } = freshJournal();
  const j1 = await Journal.open(path, "s1");
  await j1.record("write", "/v/a.md", "x", "y");
  const otherDir = mkdtempSync(join(tmpdir(), "mnemoscope-other-"));
  const otherPath = join(otherDir, ".mnemoscope", "journal.jsonl");
  const j2 = await Journal.open(otherPath, "s2");
  const e2 = await j2.record("write", "/v/b.md", "x", "y");
  // Append j2's entry to j1's journal — signed by j2's key, j1 cannot verify.
  const fs = await import("node:fs/promises");
  await fs.appendFile(path, `${JSON.stringify(e2)}\n`, "utf8");
  const j1Reopened = await Journal.open(path, "s1");
  const verified = await j1Reopened.verifyAll();
  assert.equal(verified.length, 2);
  assert.equal(verified[0]!.valid, true);
  assert.equal(verified[1]!.valid, false);
  assert.match((verified[1] as { reason: string }).reason, /unknown key/);
});

test("persists keypair across reopens", async () => {
  const { path } = freshJournal();
  const j1 = await Journal.open(path, "s1");
  const fp1 = j1.publicKeyFingerprint();
  const j2 = await Journal.open(path, "s2");
  const fp2 = j2.publicKeyFingerprint();
  assert.equal(fp1, fp2);
});
