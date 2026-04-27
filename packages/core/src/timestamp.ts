/**
 * External notary timestamping for journal entries via OpenTimestamps.
 *
 * Mnemoscope's signed hash-chained journal proves *order* and *integrity*
 * relative to the per-vault Ed25519 key. It does not prove *absolute time*:
 * if the key is later compromised, an attacker who controls the journal
 * file could in principle re-write history with backdated entries that
 * still verify under the recovered key.
 *
 * OpenTimestamps fixes that. Each entry's signature is hashed (SHA-256),
 * the digest is sent to a public OTS calendar, and the calendar returns
 * a binary proof that the digest existed at time T. Once the calendar
 * commits the digest into a Bitcoin block (typically within an hour),
 * the proof becomes a self-verifying anchor against the Bitcoin
 * blockchain. From that point on, even an attacker holding the Ed25519
 * key cannot forge an entry that is *also* anchored at time T.
 *
 * This module ships the minimal surface needed to:
 *   1. POST a digest to a calendar and receive the calendar response,
 *   2. compose a valid `.ots` file from that response,
 *   3. parse a `.ots` file's header and confirm the embedded digest.
 *
 * It does not try to *upgrade* a pending proof to a fully-self-contained
 * Bitcoin proof, nor to verify the on-chain attestation. Use the
 * upstream `ots upgrade` and `ots verify` CLIs from
 * https://github.com/opentimestamps/opentimestamps-client for that.
 */
import { createHash } from "node:crypto";

/**
 * 31-byte OTS magic, identical across all proof files.
 * Sequence is the static identifier of the OpenTimestamps proof format.
 */
const OTS_MAGIC = Uint8Array.from([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

const OTS_VERSION = 0x01;
const OTS_HASH_OP_SHA256 = 0x08;
const OTS_DIGEST_LEN = 32;
const OTS_HEADER_LEN = OTS_MAGIC.length + 1 + 1 + OTS_DIGEST_LEN;

const DEFAULT_CALENDARS = [
  "https://alice.btc.calendar.opentimestamps.org",
  "https://bob.btc.calendar.opentimestamps.org",
];

export type CalendarRequest = {
  digest: Uint8Array;
  calendarUrl?: string;
  fetchImpl?: typeof fetch;
};

export type ParsedOtsFile = {
  magicValid: boolean;
  version: number;
  hashOp: number;
  digest: Uint8Array;
  /** raw bytes of the timestamp section (calendar response). */
  timestampBody: Uint8Array;
};

/** Hash arbitrary bytes (or a base64url string) into a 32-byte SHA-256 digest. */
export function digestSha256(input: Uint8Array | string): Uint8Array {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return Uint8Array.from(createHash("sha256").update(buf).digest());
}

/**
 * POST a 32-byte SHA-256 digest to an OTS calendar's `/digest` endpoint.
 * The calendar replies with the serialized timestamp section that, when
 * prefixed with the OTS header, forms a valid `.ots` file.
 *
 * The default endpoints are public, free, and run by the OpenTimestamps
 * project. Pass a custom `calendarUrl` to point at a self-hosted calendar.
 * A custom `fetchImpl` is accepted so tests can stub the network.
 */
export async function requestCalendarTimestamp(req: CalendarRequest): Promise<Uint8Array> {
  if (req.digest.length !== OTS_DIGEST_LEN) {
    throw new Error(`expected ${OTS_DIGEST_LEN}-byte SHA-256 digest, got ${req.digest.length} bytes`);
  }
  const calendar = req.calendarUrl ?? DEFAULT_CALENDARS[0]!;
  const fetchImpl = req.fetchImpl ?? fetch;
  const url = `${calendar.replace(/\/$/, "")}/digest`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      Accept: "application/octet-stream",
      "User-Agent": "mnemoscope-timestamp",
    },
    body: req.digest,
  });
  if (!response.ok) {
    throw new Error(`calendar ${calendar} returned ${response.status} ${response.statusText}`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.length === 0) {
    throw new Error(`calendar ${calendar} returned an empty body`);
  }
  return body;
}

/**
 * Compose a valid `.ots` file from a SHA-256 digest and the calendar's
 * timestamp-section response. The resulting bytes can be written to disk
 * with the `.ots` extension and later upgraded / verified with the
 * upstream OTS CLI.
 */
export function composeOtsFile(digest: Uint8Array, timestampBody: Uint8Array): Uint8Array {
  if (digest.length !== OTS_DIGEST_LEN) {
    throw new Error(`expected ${OTS_DIGEST_LEN}-byte SHA-256 digest, got ${digest.length} bytes`);
  }
  const out = new Uint8Array(OTS_HEADER_LEN + timestampBody.length);
  out.set(OTS_MAGIC, 0);
  out[OTS_MAGIC.length] = OTS_VERSION;
  out[OTS_MAGIC.length + 1] = OTS_HASH_OP_SHA256;
  out.set(digest, OTS_MAGIC.length + 2);
  out.set(timestampBody, OTS_HEADER_LEN);
  return out;
}

/**
 * Parse a `.ots` file's header. The timestamp body is returned verbatim;
 * we deliberately do not attempt to walk its op tree. Use the upstream
 * OTS CLI for full validation.
 */
export function parseOtsFile(bytes: Uint8Array): ParsedOtsFile {
  if (bytes.length < OTS_HEADER_LEN) {
    throw new Error(`ots file too short: got ${bytes.length} bytes, need at least ${OTS_HEADER_LEN}`);
  }
  let magicValid = true;
  for (let i = 0; i < OTS_MAGIC.length; i++) {
    if (bytes[i] !== OTS_MAGIC[i]) {
      magicValid = false;
      break;
    }
  }
  const version = bytes[OTS_MAGIC.length]!;
  const hashOp = bytes[OTS_MAGIC.length + 1]!;
  const digest = bytes.slice(OTS_MAGIC.length + 2, OTS_HEADER_LEN);
  const timestampBody = bytes.slice(OTS_HEADER_LEN);
  return { magicValid, version, hashOp, digest, timestampBody };
}

/**
 * Confirm that a `.ots` file matches the digest we expected to anchor.
 * Returns a structured result rather than throwing so callers can
 * aggregate verdicts across many entries.
 */
export function verifyOtsHeaderForDigest(
  bytes: Uint8Array,
  expectedDigest: Uint8Array,
): { ok: true } | { ok: false; reason: string } {
  let parsed: ParsedOtsFile;
  try {
    parsed = parseOtsFile(bytes);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (!parsed.magicValid) return { ok: false, reason: "OTS magic mismatch" };
  if (parsed.version !== OTS_VERSION) return { ok: false, reason: `unsupported OTS version ${parsed.version}` };
  if (parsed.hashOp !== OTS_HASH_OP_SHA256) {
    return { ok: false, reason: `unsupported hash op 0x${parsed.hashOp.toString(16)}; only sha256 is recognized` };
  }
  if (parsed.digest.length !== expectedDigest.length) {
    return { ok: false, reason: "digest length mismatch" };
  }
  for (let i = 0; i < parsed.digest.length; i++) {
    if (parsed.digest[i] !== expectedDigest[i]) return { ok: false, reason: "digest mismatch" };
  }
  if (parsed.timestampBody.length === 0) {
    return { ok: false, reason: "empty timestamp body" };
  }
  return { ok: true };
}

/**
 * Compute the canonical OTS-anchor digest for a journal entry: SHA-256
 * of the entry's base64url-encoded Ed25519 signature.
 *
 * This is the digest that gets sent to the calendar. We anchor *the
 * signature* rather than the canonical entry bytes so that the anchor is
 * tied to a verifiable signing event, not to a (potentially re-canonicalized)
 * entry payload.
 */
export function digestForEntrySig(sigBase64url: string): Uint8Array {
  return digestSha256(sigBase64url);
}
