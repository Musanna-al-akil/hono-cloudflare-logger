#!/usr/bin/env node
/**
 * Bundles bench/workerd/worker.ts and runs it inside workerd through Miniflare.
 *
 * Usage: node bench/workerd/run.mjs --out <name> [--filter <substring>]
 * Writes bench/results/workerd.<name>.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    out: { type: "string", default: "latest" },
    filter: { type: "string" },
  },
});

const bundle = await build({
  entryPoints: [resolve(root, "bench/workerd/worker.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  mainFields: ["module", "main"],
  conditions: ["workerd", "worker", "import"],
  write: false,
});

const mf = new Miniflare({
  modules: true,
  compatibilityDate: "2026-07-01",
  script: bundle.outputFiles[0].text,
});

try {
  const url = new URL("http://localhost/");
  if (values.filter) {
    url.searchParams.set("filter", values.filter);
  }

  const response = await mf.dispatchFetch(url);
  if (!response.ok) {
    throw new Error(`Benchmark worker failed: ${response.status} ${await response.text()}`);
  }

  const results = await response.json();
  const outFile = resolve(root, `bench/results/workerd.${values.out}.json`);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify({ runtime: "workerd", results }, null, 2)}\n`);

  for (const result of results) {
    const hz = Math.round(result.hz).toLocaleString("en-US");
    console.log(
      `${result.group.padEnd(11)} ${result.name.padEnd(42)} ${hz.padStart(12)} ops/s ±${result.rme.toFixed(2)}%`,
    );
  }
  console.log(`\nWrote ${outFile}`);
} finally {
  await mf.dispose();
}
