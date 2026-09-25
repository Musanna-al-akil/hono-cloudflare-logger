#!/usr/bin/env node
/**
 * Rewrites absolute `filepath` values in vitest bench JSON to repo-relative
 * paths, so committed results do not depend on the machine they ran on.
 *
 * Usage: node scripts/bench-normalize.mjs <file.json>...
 */
import { readFileSync, writeFileSync } from "node:fs";

function normalize(value) {
  if (Array.isArray(value)) {
    value.forEach(normalize);
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (key === "filepath" && typeof value[key] === "string") {
        value[key] = value[key].replace(/^.*\/(bench\/)/, "$1");
      } else {
        normalize(value[key]);
      }
    }
  }
}

for (const file of process.argv.slice(2)) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  normalize(json);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
