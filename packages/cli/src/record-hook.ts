#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook that auto-records Write/Edit/MultiEdit
 * operations into the local Mnemoscope journal.
 *
 * Wire-up (in ~/.claude/settings.json or .claude/settings.json):
 *
 *   {
 *     "hooks": {
 *       "PostToolUse": [
 *         {
 *           "matcher": "Write|Edit|MultiEdit",
 *           "hooks": [
 *             {
 *               "type": "command",
 *               "command": "mnemoscope-record-hook"
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 *
 * The hook reads the Claude Code hook payload from stdin, derives the
 * vault root (via MNEMOSCOPE_VAULT_PATH or by walking up to find a
 * `.mnemoscope/` directory), reads the post-write file content, and
 * appends a signed journal entry. The hook never blocks the tool call:
 * any internal error is logged to stderr and the process exits 0 so that
 * Claude Code is not interrupted.
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { Journal, type JournalOp } from "@mnemoscope/core";

type Payload = {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
};

const VERBOSE = process.env["MNEMOSCOPE_HOOK_VERBOSE"] === "1";

void main();

async function main(): Promise<void> {
  try {
    const payload = await readPayload();
    const filePath = extractFilePath(payload);
    if (!filePath) {
      log("no file_path in payload, skipping");
      process.exit(0);
    }
    const op = mapOp(payload.tool_name);
    const vaultRoot = resolveVaultRoot(filePath);
    if (!vaultRoot) {
      log(`no vault root resolvable from ${filePath} (no MNEMOSCOPE_VAULT_PATH and no parent .mnemoscope/)`);
      process.exit(0);
    }
    const sessionId = typeof payload.session_id === "string" && payload.session_id.length > 0 ? payload.session_id : "unknown-session";
    const journal = await Journal.open(join(vaultRoot, ".mnemoscope", "journal.jsonl"), sessionId);

    let contentAfter: string | undefined;
    try {
      const st = await stat(filePath);
      if (st.isFile()) contentAfter = await readFile(filePath, "utf8");
    } catch {
      // File may have been deleted (op=delete) or path may be a directory; fine.
    }

    const entry = await journal.record(op, filePath, undefined, contentAfter);
    log(`recorded ${op} on ${filePath} (sig=${entry.sig.slice(0, 12)}…)`);
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`mnemoscope-record-hook: ${msg}\n`);
    // Never block the tool call.
    process.exit(0);
  }
}

async function readPayload(): Promise<Payload> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) return {};
  return JSON.parse(raw) as Payload;
}

function extractFilePath(p: Payload): string | null {
  const input = p.tool_input;
  if (!input) return null;
  const candidate = input["file_path"] ?? input["path"];
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  return isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
}

function mapOp(toolName: string | undefined): JournalOp {
  switch (toolName) {
    case "Write":
      return "write";
    case "Edit":
    case "MultiEdit":
      return "write";
    case "Read":
      return "read";
    default:
      return "write";
  }
}

function resolveVaultRoot(filePath: string): string | null {
  const fromEnv = process.env["MNEMOSCOPE_VAULT_PATH"];
  if (fromEnv && fromEnv.length > 0) return resolve(fromEnv);

  // Walk up until we find a `.mnemoscope/` directory or hit the filesystem
  // root. The condition compares against `dirname(current)` so we stop once
  // walking up no longer changes the path (POSIX `/`, Windows `C:\`).
  let current = dirname(resolve(filePath));
  let parent = dirname(current);
  while (current !== parent) {
    if (existsSync(join(current, ".mnemoscope"))) return current;
    // Belt-and-braces: bail at any path with no separator left.
    if (!current.includes(sep)) return null;
    current = parent;
    parent = dirname(current);
  }
  return null;
}

function log(msg: string): void {
  if (VERBOSE) process.stderr.write(`mnemoscope-record-hook: ${msg}\n`);
}
