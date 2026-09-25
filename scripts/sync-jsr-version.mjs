#!/usr/bin/env node
/**
 * Copies the package.json version into jsr.json. Runs after
 * `changeset version`, so both registries publish the same version.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const jsrPath = resolve(root, "jsr.json");
const source = readFileSync(jsrPath, "utf8");
const jsr = JSON.parse(source);

if (jsr.version !== pkg.version) {
  // Replace only the value so the file keeps its formatting.
  const updated = source.replace(/("version"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(pkg.version)}`);
  writeFileSync(jsrPath, updated);
  console.log(`jsr.json version set to ${pkg.version}`);
}
