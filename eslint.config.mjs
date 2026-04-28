/**
 * Mnemoscope ESLint config.
 *
 * The Obsidian community-plugin reviewer bot runs `eslint-plugin-obsidianmd`
 * on this repo at submission time. This file mirrors that scan locally so
 * we catch the same findings before pushing, instead of converging across
 * multiple reviewer-bot cycles.
 *
 * Scope: the only consumer of these rules is the Obsidian plugin source
 * (`packages/obsidian-plugin/src/**`) plus the slice of `@mnemoscope/core`
 * that gets bundled into the plugin (`packages/core/src/**`). The CLI and
 * MCP server packages live outside Obsidian; flagging them would surface
 * false positives without protecting any plugin user.
 */
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["packages/obsidian-plugin/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./packages/obsidian-plugin/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Per-package overrides — anything outside the plugin bundle is exempt.
    // The CLI / MCP server / core packages are platform-agnostic Node code;
    // running Obsidian-specific lints there generates false positives.
    ignores: [
      "packages/cli/**",
      "packages/mcp-server/**",
      "packages/core/**",
      "packages/*/dist/**",
      "packages/obsidian-plugin/main.js",
      "research/**",
      "examples/**",
      "node_modules/**",
      ".posts/**",
    ],
  },
]);
