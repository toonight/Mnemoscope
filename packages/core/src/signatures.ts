import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * A structural snapshot of a Markdown vault, used as input to the rot scorer
 * and the tiering layer. Heuristic; future versions will replace approximations
 * (e.g. token estimate via char count) with proper tokenizer-based measurements.
 */
export type VaultSignature = {
  rootPath: string;
  noteCount: number;
  totalChars: number;
  approxTokens: number;
  notes: NoteSignature[];
  collectedAt: string;
};

export type NoteSignature = {
  relPath: string;
  chars: number;
  approxTokens: number;
  ageDays: number;
  daysSinceModified: number;
  outboundLinks: number;
  headingCount: number;
};

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
const IGNORED_DIRS = new Set([".obsidian", ".git", "node_modules", ".trash"]);
const APPROX_CHARS_PER_TOKEN = 4;

export async function extractSignature(rootPath: string): Promise<VaultSignature> {
  const notes: NoteSignature[] = [];
  const now = Date.now();

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extOf(entry.name);
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      const fullPath = join(dir, entry.name);
      const sig = await signatureOf(fullPath, rootPath, now);
      notes.push(sig);
    }
  };

  await walk(rootPath);
  const totalChars = notes.reduce((sum, n) => sum + n.chars, 0);

  return {
    rootPath,
    noteCount: notes.length,
    totalChars,
    approxTokens: Math.round(totalChars / APPROX_CHARS_PER_TOKEN),
    notes,
    collectedAt: new Date().toISOString(),
  };
}

async function signatureOf(filePath: string, root: string, now: number): Promise<NoteSignature> {
  const [contents, st] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
  const chars = contents.length;
  const ageDays = (now - st.birthtimeMs) / 86_400_000;
  const daysSinceModified = (now - st.mtimeMs) / 86_400_000;
  const outboundLinks = countOutboundLinks(contents);
  const headingCount = countHeadings(contents);
  return {
    relPath: relative(root, filePath),
    chars,
    approxTokens: Math.round(chars / APPROX_CHARS_PER_TOKEN),
    ageDays: round2(ageDays),
    daysSinceModified: round2(daysSinceModified),
    outboundLinks,
    headingCount,
  };
}

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

function countOutboundLinks(text: string): number {
  // [[wikilinks]] + [markdown](links). Approximate.
  const wiki = text.match(/\[\[[^\]]+\]\]/g)?.length ?? 0;
  const md = text.match(/\[[^\]]+\]\([^)]+\)/g)?.length ?? 0;
  return wiki + md;
}

function countHeadings(text: string): number {
  return text.match(/^#{1,6}\s/gm)?.length ?? 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
