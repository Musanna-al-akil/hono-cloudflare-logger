# AGENTS.md

Notes for AI coding agents and new contributors. Read this before changing code.

## What this package is

`hono-cloudflare-logger` is Hono middleware plus a logger class, built for
**Cloudflare Workers Logs**. It is published to npm (built `dist/`) and JSR
(TypeScript `src/`). It has zero runtime dependencies; `hono` (`^4.8.0`) is a
peer dependency.

## Cloudflare facts that shape the design

- Workers Logs indexes the fields of **objects** passed to `console.*`, so objects are the default output. JSON strings are only full-text searchable.
- The console method becomes the event level: `debug`, `info`/`log`, `warn`, `error`. The mapping lives in `CONSOLE_METHOD_BY_PRIORITY` (`src/levels.ts`).
- Logs are billed **per event**, and events over 256 KB are truncated. Hence `bufferUntilError`, `sampleRate`, `skip` and `maxStringLength`.
- `Date.now()`/`performance.now()` only advance after I/O in production. `duration_ms` is I/O time, and CPU benchmarks must run in Node or local workerd, never in production.
- `AsyncLocalStorage` needs `nodejs_compat`. That is why `getLogger()` lives in the `./context` entry and the main entry never imports `node:*` or `hono/context-storage`.

## Module map

See [docs/architecture.md](docs/architecture.md). In short:

- `middleware.ts` — `logger()`, automatic entries and the request lifecycle.
- `logger.ts` — `Logger` and the shared per-request `LoggerCore`.
- `config.ts` — output options, resolved once.
- `sanitize.ts` — the copy-on-write safety pass.
- `error.ts` — error serialization.
- `trace.ts` — `trace_id` precedence and `traceparent`.
- `sink.ts` — writers.
- `levels.ts`, `time.ts`, `types.ts`.
- `augment.ts` — the `ContextVariableMap` augmentation.
- `context.ts` — `getLogger()`.

## Invariants (do not break)

1. **A log call never throws.** `Logger.write()` is wrapped in try/catch and falls back to `reportWriteFailure()`. Sinks, level resolvers, `skip`, trace generators and request metadata are all guarded. Request metadata and trace ids are best effort: a failure drops `req` or falls back to a generated id, never the entry.
2. **The middleware never swallows app errors.** Non-Error throws are rethrown, falsy ones included.
3. **No per-request config work.** Everything that depends only on config is resolved in `logger()` or `resolveOutput()`. The per-request core is a plain object with lazy slots.
4. **Lazy request metadata.** Headers, `cf`, query and route are read only on the first log call, and cached per `routeIndex`.
5. **Level check first.** A filtered call must return before allocating anything.
6. **No `JSON.stringify` replacer**, so V8's fast path stays available. Sanitize values beforehand instead.
7. **Zero runtime dependencies.** The main entry imports neither `node:*` nor `hono/context-storage`; only `context.ts` (the `./context` entry) uses the latter.
8. **JSR constraints.**
   - `.ts` import extensions and explicit return types on exported functions (no slow types).
   - No ambient `declare module` in the entry: keep it in `augment.ts`.
   - Check with `npm run check:jsr`.
9. **Reserved entry keys**: `level`, `msg`, `time`, `trace_id`, `data`, `err`, `req`. Context and flat data can't overwrite them.

## Commands

```bash
npm run lint            # oxfmt check + tsc + oxlint (must exit 0)
npm test                # Node: unit, integration, type tests (tests/types/*.test-d.ts)
npm run test:workers    # tests/workers/* inside workerd (@cloudflare/vitest-plugin)
npm run test:coverage   # thresholds: 95% lines/statements/functions, 90% branches
npm run build && npm run size   # gzip budgets in scripts/size.mjs
npm run check:package   # publint + attw
npm run check:jsr       # JSR publish dry run
npm run bench:compare   # Node + workerd benchmarks vs bench/results/*.baseline.json
npm run prepublish:check
```

Check exit codes directly. Piping `npm run lint` through `tail` hides failures.

## Benchmark protocol

- Run `npm run bench:compare` for any change to `src/` that could affect speed. Close other heavy processes first.
- The `control: no logger middleware` scenario measures noise. In Node it reads about +3% even on a quiet machine (an in-process effect of the other scenarios); in workerd it stays within 1%. If it moves further than that, rerun before drawing conclusions.
- Don't accept a regression over 5% in any scenario without investigating it and writing it up in `BENCHMARKS.md`. The wide-payload regression is known and documented there.
- `bench/scenarios.ts` may only use API that existed in 0.1, so the baseline stays comparable. When you add a scenario, regenerate the baseline from the 0.1 source:
  1. `git worktree add <tmp> v0.1.0-beta.1`
  2. Copy `bench/`, `scripts/` and `vitest.config.ts` into it, and symlink `node_modules`.
  3. Run `vitest bench --run --outputJson …` and `node bench/workerd/run.mjs --out baseline`.
  4. Copy the results back and run `node scripts/bench-normalize.mjs` on them.
  5. Regenerate the after results in the same session, so both sides see the same machine state.
- Micro-benchmarks can mislead. A change that wins in isolation must also win in `bench:compare`.

## Adding an option

1. Add the type and a doc comment in `src/types.ts` (`LoggerConfig`, and `OutputOptions` in `config.ts` if standalone loggers need it too).
2. Resolve and validate it once in `logger()` / `createOutput()`, and throw a `TypeError` for invalid values.
3. Add tests, including the failure path, and a type test when the option has an interesting type.
4. Update `docs/configuration.md`, and the README feature list if it is user-facing.
5. Add a changeset with `npm run changeset`.

## Examples

`examples/*` are standalone projects with their own `tsconfig.json`, and they
are **not** part of the root typecheck. They install the built package as a
copy (`.npmrc` `install-links=true`), so run `npm run build` at the root first.
CI runs `npm run check` in each (tsc + `wrangler deploy --dry-run`).

Don't add root `tsconfig` `paths` for the package name. Wrangler's esbuild
reads the nearest `tsconfig.json`, and a path alias makes an example bundle the
repo source together with the root `node_modules/hono`. That produces two
copies of hono, which silently breaks `getLogger()`.

## Releases

- Changesets in prerelease mode (`beta`). `npm run version-packages` bumps `package.json`, `jsr.json` (via `scripts/sync-jsr-version.mjs`) and `CHANGELOG.md`.
- Tags: `vX.Y.Z-beta.N` publishes to npm under the `beta` dist-tag, and any `v*` tag publishes to JSR. Both workflows check that the tag, `package.json` and `jsr.json` versions match.
- Don't push, tag or publish unless the maintainer asks.

## Commit convention

- Conventional Commits: `feat:`, `fix:`, `perf:`, `test:`, `docs:`, `ci:`, `chore(scope):`, with `!` for breaking changes.
- **No AI or agent attribution** in commit messages or metadata: no `Co-Authored-By` trailers for tools, and no mention of AI assistants or agents.
- Keep commits focused. A behavior fix goes in its own `fix:` commit, with a test.
