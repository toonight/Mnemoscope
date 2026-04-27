import { createInterface, type Interface } from "node:readline";

/**
 * Read a passphrase from one of three sources, in order:
 *   1. The MNEMOSCOPE_PASSPHRASE environment variable (for scripted use).
 *   2. stdin if it is not a TTY (so `echo "pp" | mnemoscope-backup-key …` works).
 *   3. An interactive prompt on the TTY, with characters echoed as `*`.
 *
 * When `confirm` is true, prompts twice and rejects if they differ.
 */
export async function readPassphrase(prompt: string, opts: { confirm: boolean }): Promise<string> {
  const fromEnv = process.env["MNEMOSCOPE_PASSPHRASE"];
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8").trim();
  }

  const first = await readSilent(prompt);
  if (!opts.confirm) return first;
  const second = await readSilent("Confirm passphrase: ");
  if (first !== second) {
    process.stderr.write("Passphrases do not match.\n");
    process.exit(1);
  }
  return first;
}

async function readSilent(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  return new Promise<string>((resolve) => {
    const rl: Interface = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    // Mute echo: replace each input char with '*' on the prompt line.
    const stdin = process.stdin as NodeJS.ReadStream & { _writeToOutput?: (s: string) => void };
    let collected = "";
    const onData = (key: Buffer) => {
      const s = key.toString("utf8");
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.removeListener("data", onData);
          process.stderr.write("\n");
          rl.close();
          resolve(collected);
          return;
        }
        if (ch === "") {
          process.stderr.write("\n");
          process.exit(130);
        }
        if (ch === "" || ch === "\b") {
          collected = collected.slice(0, -1);
          process.stderr.write("\b \b");
        } else {
          collected += ch;
          process.stderr.write("*");
        }
      }
    };
    if (typeof (stdin as { setRawMode?: (mode: boolean) => void }).setRawMode === "function") {
      (stdin as { setRawMode: (mode: boolean) => void }).setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onData);
  });
}

/** Parse trailing `--flag` and `--key value` arguments into a map. */
export function parseFlags(args: string[], known: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) continue;
    const name = a.slice(2);
    if (!known.includes(name)) continue;
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[name] = next;
      i++;
    } else {
      out[name] = "";
    }
  }
  return out;
}
