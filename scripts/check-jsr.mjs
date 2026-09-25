#!/usr/bin/env node
/**
 * Fails when a module reachable from a jsr.json export augments another
 * module or the global scope. JSR rejects that only on the server
 * ("modifying global types is not allowed"), so `jsr publish --dry-run`
 * doesn't catch it.
 *
 * Usage: node scripts/check-jsr.mjs (runs as part of `npm run check:jsr`)
 */
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsr = JSON.parse(readFileSync(resolve(root, "jsr.json"), "utf8"));

const AUGMENTATION = /^\s*(?:declare\s+(?:global|module\s+["'])|export\s+as\s+namespace\b)/m;
const RELATIVE_IMPORT = /(?:^|\n)\s*(?:import|export)\b[^;]*?["'](\.{1,2}\/[^"']+)["']/g;

const pending = Object.values(jsr.exports).map((entry) => resolve(root, entry));
const seen = new Set();
const offenders = [];

while (pending.length > 0) {
  const file = pending.pop();
  if (seen.has(file)) continue;
  seen.add(file);

  const source = readFileSync(file, "utf8");
  if (AUGMENTATION.test(source)) offenders.push(relative(root, file));
  for (const [, specifier] of source.matchAll(RELATIVE_IMPORT)) {
    pending.push(resolve(dirname(file), specifier));
  }
}

if (offenders.length > 0) {
  console.error(
    `JSR rejects module and global augmentation. Reachable from jsr.json exports: ${offenders.join(", ")}`,
  );
  process.exit(1);
}
console.log(`No augmentation in the JSR module graph (${seen.size} modules).`);
