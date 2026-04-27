import { appendFile, mkdir, readFile, writeFile, access, constants, chmod } from "node:fs/promises";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { dirname, join } from "node:path";

export type JournalOp = "read" | "write" | "create" | "delete";

/**
 * One append-only journal entry.
 *
 * `sig` is an Ed25519 signature over the canonical JSON of the unsigned
 * payload (every field except `sig` and `keyFingerprint`). Tampering with
 * any field invalidates the signature.
 *
 * `prevHash` is the SHA-256 hash of the previous entry's `sig`, truncated
 * to 32 hex chars. The first entry uses the literal "GENESIS". Together,
 * `sig` + `prevHash` form a hash chain: any deletion or reordering of
 * entries breaks the chain on the entry that follows the gap, even though
 * each individual entry's signature still verifies.
 *
 * `keyFingerprint` is the SHA-256 fingerprint of the SPKI-encoded public
 * key, truncated to 16 hex chars. It lets a verifier identify which key
 * signed an entry without loading the full public-key material.
 */
export type JournalEntry = {
  ts: string;
  sessionId: string;
  op: JournalOp;
  path: string;
  bytesBefore?: number;
  bytesAfter?: number;
  contentHashAfter?: string;
  diffHash?: string;
  prevHash: string;
  keyFingerprint: string;
  sig: string;
};

export const GENESIS_PREV_HASH = "GENESIS";

export type VerifiedJournalEntry =
  | { entry: JournalEntry; valid: true }
  | { entry: JournalEntry; valid: false; reason: string };

/**
 * Append-only signed journal of agent operations on a vault.
 *
 * v1 properties:
 *   - Each entry is signed with a per-vault Ed25519 keypair.
 *   - The signature covers a deterministic JSON canonicalization of the
 *     entry (sorted keys, no whitespace) so that re-serializing yields the
 *     same bytes.
 *   - Tampering with any field of an entry, in any line of the JSONL file,
 *     fails verification.
 *   - The private key is stored at <vault>/.mnemoscope/keys/ed25519.key with
 *     mode 0600. The public key is stored alongside as ed25519.pub for
 *     external verification or sharing.
 *   - Truncating the journal file (removing entries) cannot be detected by
 *     per-entry signatures; future versions will chain entries (entry N
 *     signs the hash of entry N-1) to make truncation detectable.
 */
export class Journal {
  private constructor(
    private readonly path: string,
    private readonly sessionId: string,
    private readonly privateKey: KeyObject,
    private readonly publicKey: KeyObject,
    private readonly keyFingerprint: string,
  ) {}

  /**
   * Open (or create) the journal at `path`. If a per-vault Ed25519 keypair
   * does not exist next to the journal, one is generated. The last entry's
   * signature is loaded so that the next `record()` can correctly chain
   * onto it.
   */
  static async open(path: string, sessionId: string): Promise<Journal> {
    await mkdir(dirname(path), { recursive: true });
    const keyDir = join(dirname(path), "keys");
    const { privateKey, publicKey, fingerprint } = await loadOrCreateKeyPair(keyDir);
    const journal = new Journal(path, sessionId, privateKey, publicKey, fingerprint);
    journal.lastSig = await journal.tailSig();
    return journal;
  }

  private lastSig: string | null = null;

  publicKeyFingerprint(): string {
    return this.keyFingerprint;
  }

  exportPublicKeyPem(): string {
    return this.publicKey.export({ format: "pem", type: "spki" }).toString();
  }

  async record(
    op: JournalOp,
    target: string,
    contentBefore?: string,
    contentAfter?: string,
  ): Promise<JournalEntry> {
    const unsigned = {
      ts: new Date().toISOString(),
      sessionId: this.sessionId,
      op,
      path: target,
      ...(contentBefore !== undefined ? { bytesBefore: Buffer.byteLength(contentBefore, "utf8") } : {}),
      ...(contentAfter !== undefined ? { bytesAfter: Buffer.byteLength(contentAfter, "utf8") } : {}),
      ...(contentAfter !== undefined ? { contentHashAfter: hashHex(contentAfter) } : {}),
      ...(contentBefore !== undefined && contentAfter !== undefined
        ? { diffHash: hashHex(`${hashHex(contentBefore)}::${hashHex(contentAfter)}`) }
        : {}),
      prevHash: this.lastSig === null ? GENESIS_PREV_HASH : hashHex(this.lastSig),
    };
    const sig = signCanonical(unsigned, this.privateKey);
    const entry: JournalEntry = { ...unsigned, keyFingerprint: this.keyFingerprint, sig };
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
    this.lastSig = sig;
    return entry;
  }

  private async tailSig(): Promise<string | null> {
    const entries = await this.readAll();
    if (entries.length === 0) return null;
    return entries[entries.length - 1]!.sig;
  }

  /**
   * Read all entries without verifying signatures. Use {@link verifyAll}
   * if you need to know which entries are tamper-free.
   */
  async readAll(): Promise<JournalEntry[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      return raw
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as JournalEntry);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  /**
   * Read all entries and verify, in order:
   *   1. each entry's Ed25519 signature against the current vault's key,
   *   2. the hash chain — entry N's `prevHash` must equal SHA-256(entry
   *      N-1's `sig`); the first entry must use the GENESIS sentinel.
   *
   * A break in the hash chain means an entry was deleted or reordered;
   * the per-entry signature alone does not catch that.
   */
  async verifyAll(): Promise<VerifiedJournalEntry[]> {
    const entries = await this.readAll();
    const out: VerifiedJournalEntry[] = [];
    let prevSig: string | null = null;
    for (const entry of entries) {
      if (entry.keyFingerprint !== this.keyFingerprint) {
        out.push({
          entry,
          valid: false,
          reason: `signed by unknown key ${entry.keyFingerprint}; current key is ${this.keyFingerprint}`,
        });
        prevSig = entry.sig;
        continue;
      }
      const expectedPrev = prevSig === null ? GENESIS_PREV_HASH : hashHex(prevSig);
      if (entry.prevHash !== expectedPrev) {
        out.push({
          entry,
          valid: false,
          reason: `chain break: prevHash=${entry.prevHash} but expected ${expectedPrev}`,
        });
        prevSig = entry.sig;
        continue;
      }
      const ok = verifyCanonical(entry, this.publicKey);
      out.push(ok ? { entry, valid: true } : { entry, valid: false, reason: "signature mismatch" });
      prevSig = entry.sig;
    }
    return out;
  }
}

async function loadOrCreateKeyPair(
  keyDir: string,
): Promise<{ privateKey: KeyObject; publicKey: KeyObject; fingerprint: string }> {
  await mkdir(keyDir, { recursive: true });
  const privPath = join(keyDir, "ed25519.key");
  const pubPath = join(keyDir, "ed25519.pub");
  try {
    await access(privPath, constants.R_OK);
    const [privPem, pubPem] = await Promise.all([readFile(privPath, "utf8"), readFile(pubPath, "utf8")]);
    return {
      privateKey: createPrivateKey({ key: privPem, format: "pem" }),
      publicKey: createPublicKey({ key: pubPem, format: "pem" }),
      fingerprint: fingerprintOf(pubPem),
    };
  } catch {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const pubPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    await writeFile(privPath, privPem, "utf8");
    await writeFile(pubPath, pubPem, "utf8");
    await chmod(privPath, 0o600);
    return { privateKey, publicKey, fingerprint: fingerprintOf(pubPem) };
  }
}

/**
 * Deterministic JSON canonicalization: sorted keys, no whitespace.
 * Excludes the `sig` and `keyFingerprint` fields by construction (the caller
 * is expected to pass an entry without them when computing the signature
 * input).
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

function signCanonical(unsigned: unknown, privateKey: KeyObject): string {
  const canonical = Buffer.from(canonicalize(unsigned), "utf8");
  return sign(null, canonical, privateKey).toString("base64url");
}

function verifyCanonical(entry: JournalEntry, publicKey: KeyObject): boolean {
  const { sig, keyFingerprint: _kf, ...rest } = entry;
  const canonical = Buffer.from(canonicalize(rest), "utf8");
  try {
    return verify(null, canonical, publicKey, Buffer.from(sig, "base64url"));
  } catch {
    return false;
  }
}

function fingerprintOf(pubPem: string): string {
  return createHash("sha256").update(pubPem, "utf8").digest("hex").slice(0, 16);
}

function hashHex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 32);
}
