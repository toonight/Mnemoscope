import { build, context } from "esbuild";

const isProduction = process.argv[2] === "production";

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node:*"],
  format: "cjs",
  target: "es2022",
  platform: "browser",
  outfile: "main.js",
  sourcemap: isProduction ? false : "inline",
  treeShaking: true,
  logLevel: "info",
};

if (isProduction) {
  await build(options);
} else {
  const ctx = await context(options);
  await ctx.watch();
}
