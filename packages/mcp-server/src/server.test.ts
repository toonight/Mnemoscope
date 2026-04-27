/**
 * Integration tests: spawn the MCP server as a child process and exchange
 * real JSON-RPC messages over stdio, exactly as Claude Code / Cursor / any
 * other MCP client would.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_BIN = resolve(here, "../dist/index.js");

class McpClient {
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private constructor(private readonly proc: ChildProcessWithoutNullStreams) {}

  static async start(env: Record<string, string> = {}): Promise<McpClient> {
    const proc = spawn("node", [SERVER_BIN], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    const client = new McpClient(proc);
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => client.onData(chunk));
    // Drain stderr so the test runner can surface server errors if anything explodes.
    proc.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[server stderr] ${chunk.toString()}`));
    await client.initialize();
    return client;
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (line.length === 0) continue;
      let msg: { id?: number; result?: unknown; error?: { message: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id === "number") {
        const waiter = this.pending.get(msg.id);
        if (!waiter) continue;
        this.pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(msg.error.message));
        else waiter.resolve(msg.result);
      }
    }
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.proc.stdin.write(`${payload}\n`);
    return new Promise((resolveFn, reject) => {
      this.pending.set(id, { resolve: resolveFn, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout waiting for response to ${method}`));
        }
      }, 5_000);
    });
  }

  private notify(method: string, params?: unknown): void {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.proc.stdin.write(`${payload}\n`);
  }

  private async initialize(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mnemoscope-tests", version: "0.0.1" },
    });
    this.notify("notifications/initialized");
  }

  async listTools(): Promise<{ name: string; description?: string }[]> {
    const result = (await this.send("tools/list")) as { tools: { name: string; description?: string }[] };
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = (await this.send("tools/call", { name, arguments: args })) as {
      content: { type: string; text: string }[];
    };
    const first = result.content[0];
    if (!first || first.type !== "text") throw new Error("expected text content");
    return JSON.parse(first.text);
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

function makeFixtureVault(): string {
  const dir = mkdtempSync(join(tmpdir(), "mnemoscope-it-"));
  writeFileSync(join(dir, "small.md"), "# small\n\nA short note about widgets.\n", "utf8");
  writeFileSync(join(dir, "medium.md"), `# medium\n\n${"sentence about widgets. ".repeat(400)}`, "utf8");
  mkdirSync(join(dir, "subdir"), { recursive: true });
  writeFileSync(
    join(dir, "subdir", "linked.md"),
    `# linked\n\nSee [[small]] and [[medium]] for context.\n\n## one\n## two\n## three\n`,
    "utf8",
  );
  return dir;
}

test("server lists exactly four tools", async () => {
  const client = await McpClient.start();
  try {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["get_tiered_read", "predict_rot", "read_journal", "record_journal"]);
    for (const t of tools) {
      assert.ok(t.description && t.description.length > 0, `tool ${t.name} must have a description`);
    }
  } finally {
    client.close();
  }
});

test("predict_rot returns a complete result on a fixture vault", async () => {
  const client = await McpClient.start();
  const vault = makeFixtureVault();
  try {
    const out = (await client.callTool("predict_rot", { vault_path: vault })) as {
      rot_risk: number;
      dominant_factor: string;
      factors: Record<string, number>;
      top_risk_notes: { relPath: string; approxTokens: number; reason: string }[];
      vault_stats: { noteCount: number; approxTokens: number };
      baseline_model: string;
    };
    assert.equal(typeof out.rot_risk, "number");
    assert.ok(out.rot_risk >= 0 && out.rot_risk <= 100, `rot_risk out of range: ${out.rot_risk}`);
    assert.ok(["tokenVolume", "semanticRedundancy", "distractorDensity", "structuralCoherence", "freshnessSpread"].includes(out.dominant_factor));
    assert.equal(out.vault_stats.noteCount, 3);
    assert.ok(out.top_risk_notes.length > 0);
    assert.equal(out.baseline_model, "v0-heuristic");
  } finally {
    client.close();
  }
});

test("get_tiered_read places fresh notes into the working layer", async () => {
  const client = await McpClient.start();
  const vault = makeFixtureVault();
  try {
    const out = (await client.callTool("get_tiered_read", { vault_path: vault })) as {
      counts: { working: number; episodic: number; semantic: number };
      working: string[];
    };
    // Fixture files were just created, so every note should be in "working".
    assert.equal(out.counts.working, 3);
    assert.equal(out.counts.episodic, 0);
    assert.equal(out.counts.semantic, 0);
  } finally {
    client.close();
  }
});

test("record_journal then read_journal round-trips a signed entry", async () => {
  const client = await McpClient.start();
  const vault = makeFixtureVault();
  try {
    const recorded = (await client.callTool("record_journal", {
      vault_path: vault,
      session_id: "it-session",
      op: "write",
      target_path: join(vault, "small.md"),
      content_after: "new content",
    })) as { sig: string; keyFingerprint: string; op: string };
    assert.equal(recorded.op, "write");
    assert.ok(recorded.sig.length > 0);
    assert.ok(recorded.keyFingerprint.length === 16);

    const read = (await client.callTool("read_journal", {
      vault_path: vault,
      session_id: "it-session",
    })) as { count: number; entries: { sig: string; op: string }[] };
    assert.equal(read.count, 1);
    assert.equal(read.entries[0]!.sig, recorded.sig);
  } finally {
    client.close();
  }
});

test("missing vault_path argument produces a server-side error response", async () => {
  const client = await McpClient.start();
  try {
    await assert.rejects(
      () => client.callTool("predict_rot", {}),
      /vault_path/,
    );
  } finally {
    client.close();
  }
});
