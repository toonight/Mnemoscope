import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeOtsFile,
  digestForEntrySig,
  digestSha256,
  parseOtsFile,
  requestCalendarTimestamp,
  verifyOtsHeaderForDigest,
} from "./timestamp.js";

const FIXTURE_DIGEST = digestSha256("mnemoscope-test-payload");
const FIXTURE_BODY = Uint8Array.from([
  // A fabricated calendar response: not a real attestation tree, but
  // structurally arbitrary bytes the parser must round-trip verbatim.
  0xf0, 0x05, 0x01, 0x02, 0x03, 0x04, 0x05, 0x08, 0x00, 0x83, 0xdf, 0xe3, 0x0d,
]);

test("composeOtsFile + parseOtsFile round-trips digest and body", () => {
  const ots = composeOtsFile(FIXTURE_DIGEST, FIXTURE_BODY);
  const parsed = parseOtsFile(ots);
  assert.equal(parsed.magicValid, true);
  assert.equal(parsed.version, 0x01);
  assert.equal(parsed.hashOp, 0x08);
  assert.deepEqual(parsed.digest, FIXTURE_DIGEST);
  assert.deepEqual(parsed.timestampBody, FIXTURE_BODY);
});

test("verifyOtsHeaderForDigest accepts a matching digest", () => {
  const ots = composeOtsFile(FIXTURE_DIGEST, FIXTURE_BODY);
  const result = verifyOtsHeaderForDigest(ots, FIXTURE_DIGEST);
  assert.equal(result.ok, true);
});

test("verifyOtsHeaderForDigest rejects a digest mismatch", () => {
  const ots = composeOtsFile(FIXTURE_DIGEST, FIXTURE_BODY);
  const otherDigest = digestSha256("a different payload");
  const result = verifyOtsHeaderForDigest(ots, otherDigest);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /digest mismatch/);
});

test("verifyOtsHeaderForDigest rejects an empty timestamp body", () => {
  const empty = composeOtsFile(FIXTURE_DIGEST, new Uint8Array());
  const result = verifyOtsHeaderForDigest(empty, FIXTURE_DIGEST);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /empty timestamp body/);
});

test("verifyOtsHeaderForDigest rejects bad magic bytes", () => {
  const ots = composeOtsFile(FIXTURE_DIGEST, FIXTURE_BODY);
  ots[0] = 0xff;
  const result = verifyOtsHeaderForDigest(ots, FIXTURE_DIGEST);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /OTS magic mismatch/);
});

test("composeOtsFile rejects non-32-byte digests", () => {
  assert.throws(() => composeOtsFile(new Uint8Array(31), FIXTURE_BODY), /32-byte/);
});

test("parseOtsFile rejects too-short input", () => {
  assert.throws(() => parseOtsFile(new Uint8Array(10)), /too short/);
});

test("digestForEntrySig is the sha256 of the signature string", () => {
  const sig = "abc123-fake-signature";
  assert.deepEqual(digestForEntrySig(sig), digestSha256(sig));
});

test("requestCalendarTimestamp posts the digest and returns the body", async () => {
  const captured: { url?: string; method?: string; body?: Uint8Array } = {};
  const fakeBody = Uint8Array.from([0xf0, 0x01, 0xaa]);
  const fakeFetch: typeof fetch = async (input, init) => {
    captured.url = typeof input === "string" ? input : input.toString();
    captured.method = init?.method;
    const b = init?.body;
    captured.body = b instanceof Uint8Array ? b : new Uint8Array(b as ArrayBufferLike);
    return new Response(fakeBody, { status: 200 });
  };
  const out = await requestCalendarTimestamp({
    digest: FIXTURE_DIGEST,
    calendarUrl: "https://example.test",
    fetchImpl: fakeFetch,
  });
  assert.deepEqual(out, fakeBody);
  assert.equal(captured.url, "https://example.test/digest");
  assert.equal(captured.method, "POST");
  assert.deepEqual(captured.body, FIXTURE_DIGEST);
});

test("requestCalendarTimestamp surfaces non-200 calendar errors", async () => {
  const fakeFetch: typeof fetch = async () => new Response("nope", { status: 503, statusText: "Service Unavailable" });
  await assert.rejects(
    () =>
      requestCalendarTimestamp({
        digest: FIXTURE_DIGEST,
        calendarUrl: "https://example.test",
        fetchImpl: fakeFetch,
      }),
    /503/,
  );
});

test("requestCalendarTimestamp rejects empty calendar bodies", async () => {
  const fakeFetch: typeof fetch = async () => new Response(new Uint8Array(), { status: 200 });
  await assert.rejects(
    () =>
      requestCalendarTimestamp({
        digest: FIXTURE_DIGEST,
        calendarUrl: "https://example.test",
        fetchImpl: fakeFetch,
      }),
    /empty body/,
  );
});

test("requestCalendarTimestamp rejects wrong-length digests early", async () => {
  await assert.rejects(
    () =>
      requestCalendarTimestamp({
        digest: new Uint8Array(31),
        calendarUrl: "https://example.test",
      }),
    /32-byte/,
  );
});
