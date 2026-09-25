#!/usr/bin/env node
/**
 * Reports the bundle cost of each built entry point: raw, minified and
 * minified + gzip. Fails when an entry exceeds its gzip budget.
 *
 * Usage: node scripts/size.mjs (run `npm run build` first)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Gzip budgets in bytes, per entry. */
const ENTRIES = [
  { file: "dist/index.js", budget: 5120 },
  { file: "dist/context.js", budget: 4096, optional: true },
];

let failed = false;
for (const entry of ENTRIES) {
  const file = resolve(root, entry.file);
  if (!existsSync(file)) {
    if (!entry.optional) {
      console.error(`${entry.file} not found. Run \`npm run build\` first.`);
      failed = true;
    }
    continue;
  }

  const raw = readFileSync(file);
  // Bundle local chunks but keep peer dependencies external, as consumers would.
  const minified = await build({
    entryPoints: [file],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "neutral",
    external: ["hono", "hono/*", "node:*"],
    write: false,
  });
  const minifiedBytes = minified.outputFiles[0].contents;
  const gzipBytes = gzipSync(minifiedBytes, { level: 9 }).length;
  const overBudget = gzipBytes > entry.budget;
  failed ||= overBudget;

  console.log(
    `${entry.file.padEnd(16)} raw ${String(raw.length).padStart(6)} B | min ${String(minifiedBytes.length).padStart(6)} B | min+gzip ${String(gzipBytes).padStart(5)} B (budget ${entry.budget} B)${overBudget ? "  OVER BUDGET" : ""}`,
  );
}

process.exit(failed ? 1 : 0);
