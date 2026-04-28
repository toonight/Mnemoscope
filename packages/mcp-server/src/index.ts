#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  computeRotScore,
  extractSignature,
  Journal,
  tierVault,
} from "@mnemoscope/core";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const SERVER_NAME = "mnemoscope";
const SERVER_VERSION = "0.1.0";

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({
  tools: [
    {
      name: "predict_rot",
      description:
        "Compute a predictive context-rot risk score (0-100) for a Markdown vault before injecting it into an LLM. Returns the score, a breakdown of contributing factors, and the 5 highest-risk notes.",
      inputSchema: {
        type: "object",
        properties: {
          vault_path: {
            type: "string",
            description: "Absolute path to the vault root directory.",
          },
        },
        required: ["vault_path"],
      },
    },
    {
      name: "get_tiered_read",
      description:
        "Returns a tiered (working / episodic / semantic) view of a Markdown vault, designed to be used as a compacted context substitute instead of injecting the full vault.",
      inputSchema: {
        type: "object",
        properties: {
          vault_path: { type: "string" },
          working_max_age_days: { type: "number", default: 7 },
          episodic_max_age_days: { type: "number", default: 90 },
        },
        required: ["vault_path"],
      },
    },
    {
      name: "record_journal",
      description:
        "Append an entry to the local signed journal of agent operations on a vault. Use this to record reads, writes, creates, or deletes performed during a session.",
      inputSchema: {
        type: "object",
        properties: {
          vault_path: { type: "string" },
          session_id: { type: "string" },
          op: { type: "string", enum: ["read", "write", "create", "delete"] },
          target_path: { type: "string" },
          content_before: { type: "string" },
          content_after: { type: "string" },
        },
        required: ["vault_path", "session_id", "op", "target_path"],
      },
    },
    {
      name: "read_journal",
      description: "Read the journal entries for a vault. Optionally filter by session_id.",
      inputSchema: {
        type: "object",
        properties: {
          vault_path: { type: "string" },
          session_id: { type: "string" },
        },
        required: ["vault_path"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  switch (name) {
    case "predict_rot": {
      const sig = await extractSignature(stringArg(args, "vault_path"));
      const result = computeRotScore(sig);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                rot_risk: result.score,
                dominant_factor: result.dominantFactor,
                factors: result.factors,
                top_risk_notes: result.topRiskNotes,
                vault_stats: {
                  noteCount: sig.noteCount,
                  approxTokens: sig.approxTokens,
                },
                baseline_model: result.baselineModel,
                version: SERVER_VERSION,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    case "get_tiered_read": {
      const sig = await extractSignature(stringArg(args, "vault_path"));
      const tiers = tierVault(sig, {
        workingMaxAgeDays: numberArg(args, "working_max_age_days", 7),
        episodicMaxAgeDays: numberArg(args, "episodic_max_age_days", 90),
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                policy: tiers.policy,
                counts: {
                  working: tiers.working.length,
                  episodic: tiers.episodic.length,
                  semantic: tiers.semantic.length,
                },
                working: tiers.working.map((n) => n.relPath),
                episodic: tiers.episodic.map((n) => n.relPath),
                semantic_index: tiers.semantic.map((n) => ({
                  path: n.relPath,
                  approxTokens: n.approxTokens,
                  daysSinceModified: n.daysSinceModified,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    case "record_journal": {
      const vaultPath = stringArg(args, "vault_path");
      const sessionId = stringArg(args, "session_id");
      const op = stringArg(args, "op") as "read" | "write" | "create" | "delete";
      const target = stringArg(args, "target_path");
      const journal = await Journal.open(journalPathFor(vaultPath), sessionId);
      const contentBefore = args["content_before"];
      const contentAfter = args["content_after"];
      const entry = await journal.record(
        op,
        target,
        typeof contentBefore === "string" ? contentBefore : undefined,
        typeof contentAfter === "string" ? contentAfter : undefined,
      );
      return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
    }

    case "read_journal": {
      const vaultPath = stringArg(args, "vault_path");
      const sessionIdArg = args["session_id"];
      const sessionId = typeof sessionIdArg === "string" ? sessionIdArg : null;
      const journal = await Journal.open(journalPathFor(vaultPath), sessionId ?? randomUUID());
      const entries = await journal.readAll();
      const filtered = sessionId ? entries.filter((e) => e.sessionId === sessionId) : entries;
      return { content: [{ type: "text", text: JSON.stringify({ count: filtered.length, entries: filtered }, null, 2) }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

function stringArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`Argument '${key}' must be a non-empty string`);
  return v;
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function journalPathFor(vaultPath: string): string {
  return join(vaultPath, ".mnemoscope", "journal.jsonl");
}

const transport = new StdioServerTransport();
await server.connect(transport);
