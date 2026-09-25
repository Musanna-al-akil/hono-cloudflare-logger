#!/usr/bin/env node
/**
 * Builds a Markdown before/after table from benchmark result files.
 *
 * Usage: node scripts/bench-report.mjs [--before baseline] [--after after]
 * Reads bench/results/{node,workerd}.<name>.json for each side.
 */
import { existsSync, readFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    before: { type: "string", default: "baseline" },
    after: { type: "string", default: "after" },
  },
});

/** Normalizes vitest `--outputJson` and the workerd runner output to one shape. */
function load(runtime, name) {
  const file = resolve(root, `bench/results/${runtime}.${name}.json`);
  if (!existsSync(file)) {
    return undefined;
  }

  const json = JSON.parse(readFileSync(file, "utf8"));
  if (Array.isArray(json.results)) {
    return json.results;
  }

  return json.files.flatMap((benchFile) =>
    benchFile.groups.flatMap((group) =>
      group.benchmarks.map((benchmark) => ({
        group: group.fullName.split(" > ").at(-1),
        name: benchmark.name,
        hz: benchmark.hz,
        rme: benchmark.rme,
      })),
    ),
  );
}

function formatHz(hz) {
  return Math.round(hz).toLocaleString("en-US");
}

function formatDelta(before, after) {
  const ratio = after / before;
  const percent = (ratio - 1) * 100;
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${percent.toFixed(1)}% (${ratio.toFixed(2)}x)`;
}

const sections = [];
for (const runtime of ["node", "workerd"]) {
  const before = load(runtime, values.before);
  const after = load(runtime, values.after);
  if (!before || !after) {
    continue;
  }

  const lines = [
    `### ${runtime === "node" ? `Node.js ${process.version}` : "workerd (Miniflare)"}`,
    "",
    "| Group | Scenario | Before (ops/s) | After (ops/s) | Change |",
    "| --- | --- | ---: | ---: | ---: |",
  ];

  for (const result of after) {
    const previous = before.find(
      (item) => item.group === result.group && item.name === result.name,
    );
    const beforeCell = previous ? `${formatHz(previous.hz)} ±${previous.rme.toFixed(1)}%` : "n/a";
    const change = previous ? formatDelta(previous.hz, result.hz) : "new";
    lines.push(
      `| ${result.group} | ${result.name} | ${beforeCell} | ${formatHz(result.hz)} ±${result.rme.toFixed(1)}% | ${change} |`,
    );
  }

  sections.push(lines.join("\n"));
}

if (sections.length === 0) {
  console.error(`No result pairs found for "${values.before}" and "${values.after}".`);
  process.exit(1);
}

const cpu = cpus()[0]?.model ?? "unknown CPU";
console.log(`Environment: ${cpu}, ${platform()} ${release()}, Node.js ${process.version}\n`);
console.log(sections.join("\n\n"));
