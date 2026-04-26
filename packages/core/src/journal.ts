import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

export type JournalOp = "read" | "write" | "create" | "delete";

export type JournalEntry = {
  ts: string;
  sessionId: string;
  op: JournalOp;
  path: string;
  bytesBefore?: number;
  bytesAfter?: number;
  contentHashAfter?: string;
  diffHash?: string;
};

/**
 * Append-only JSONL journal of agent operations on a vault. Designed for
 * forensic replay: each entry is one line, hashes are local-only, no network.
 *
 * v0 stores plain JSONL. A future version will sign each entry with a per-vault
 * Ed25519 keypair so that tampering with the log is detectable.
 */
export class Journal {
  private constructor(private readonly path: string, private readonly sessionId: string) {}

  static async open(path: string, sessionId: string): Promise<Journal> {
    await mkdir(dirname(path), { recursive: true });
    return new Journal(path, sessionId);
  }

  async record(op: JournalOp, target: string, contentBefore?: string, contentAfter?: string): Promise<JournalEntry> {
    const entry: JournalEntry = {
      ts: new Date().toISOString(),
      sessionId: this.sessionId,
      op,
      path: target,
      ...(contentBefore !== undefined ? { bytesBefore: Buffer.byteLength(contentBefore, "utf8") } : {}),
      ...(contentAfter !== undefined ? { bytesAfter: Buffer.byteLength(contentAfter, "utf8") } : {}),
      ...(contentAfter !== undefined ? { contentHashAfter: hash(contentAfter) } : {}),
      ...(contentBefore !== undefined && contentAfter !== undefined
        ? { diffHash: hash(`${hash(contentBefore)}::${hash(contentAfter)}`) }
        : {}),
    };
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

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
}

function hash(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 32);
}
