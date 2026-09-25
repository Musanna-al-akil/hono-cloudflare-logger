# Benchmarks

Before/after numbers for `0.1.0-beta.1` → `0.2.0-beta.0`. The same scenario
file ([`bench/scenarios.ts`](bench/scenarios.ts)) runs against both versions;
it only uses API that exists in 0.1, so the comparison is like for like.

## Methodology

- **Runtimes.** Node.js through `vitest bench` (tinybench), and **workerd**, the
  Cloudflare Workers runtime, through Miniflare with a custom batch timer
  ([`bench/workerd`](bench/workerd)). Local workerd has 1 ms timers, so each
  sample times a calibrated batch of ~50 ms; 3 warmup and 20 measured batches.
  Production Workers freeze `Date.now()`/`performance.now()` between I/O, so
  CPU benchmarks cannot run there.
- **Equal footing.** Every `console` method is replaced with a sink that calls
  `JSON.stringify` on object arguments. 0.2 hands objects to the console
  instead of strings; the sink charges it for the serialization the runtime
  does anyway, so object mode gets no free win.
- **Both versions, same session.** The baseline is the `v0.1.0-beta.1` tag
  (a worktree with the current harness copied in); the after numbers are
  `0.2.0-beta.0`. They ran back to back in two rounds, 0.1 first in one round
  and 0.2 first in the other, and the tables show the **mean of the two
  rounds** (± is the larger of the two margins).
- **Noise.** The middleware `control` scenario (no logger at all) moved +3.0% and
  +3.4% in Node and −0.1% and −0.6% in workerd. Because the Node shift has the
  same sign whichever version ran first, it is an in-process effect, not
  machine drift. workerd scenarios agreed within 5 points between rounds. Node
  middleware scenarios did not: `silent, no logs` measured +21% in one round
  and +3% in the other. Treat single-digit Node middleware differences as
  noise.
- **Reproduce.** `npm run bench:compare` compares the current source against
  `bench/results/*.baseline.json` and prints the tables below. Raw results are
  in [`bench/results`](bench/results).

## Results

Environment: Apple M1, darwin 24.6.0, Node.js v24.21.0

### Node.js v24.21.0

| Group      | Scenario                                         |   Before (ops/s) |    After (ops/s) |          Change |
| ---------- | ------------------------------------------------ | ---------------: | ---------------: | --------------: |
| logger     | construct logger (6 redact keys)                 |  4,905,653 ±0.7% |  8,377,093 ±1.5% |  +70.8% (1.71x) |
| logger     | info, small payload                              |  1,111,830 ±0.1% |  2,005,243 ±0.2% |  +80.4% (1.80x) |
| logger     | debug below min level (filtered)                 | 24,095,979 ±0.1% | 30,420,355 ±0.1% |  +26.2% (1.26x) |
| logger     | info, nested payload + 6 redact keys             |    323,736 ±0.3% |    446,246 ±2.0% |  +37.8% (1.38x) |
| logger     | info, context + 6 redact keys                    |    681,297 ±0.3% |  1,401,019 ±0.2% | +105.6% (2.06x) |
| logger     | error with Error instance                        |    408,379 ±3.8% |    528,419 ±0.2% |  +29.4% (1.29x) |
| logger     | info, wide payload (50 fields)                   |    258,944 ±0.2% |    211,676 ±0.2% |  -18.3% (0.82x) |
| logger     | info, wide payload (50 fields, fast-mode object) |    440,699 ±0.2% |    361,016 ±0.4% |  -18.1% (0.82x) |
| middleware | control: no logger middleware                    |    510,421 ±0.6% |    526,704 ±0.4% |   +3.2% (1.03x) |
| middleware | silent, no logs                                  |    347,598 ±0.6% |    389,109 ±1.2% |  +11.9% (1.12x) |
| middleware | silent, 3 handler logs + redact                  |    121,887 ±0.4% |    181,704 ±4.1% |  +49.1% (1.49x) |
| middleware | access log                                       |    214,990 ±2.8% |    240,026 ±0.4% |  +11.6% (1.12x) |
| middleware | access log + 15 headers + cf + redact            |    119,353 ±3.3% |    151,584 ±0.3% |  +27.0% (1.27x) |
| middleware | error mode, thrown error                         |    135,945 ±0.4% |    141,139 ±0.3% |   +3.8% (1.04x) |

### workerd (Miniflare)

| Group      | Scenario                                         |    Before (ops/s) |     After (ops/s) |          Change |
| ---------- | ------------------------------------------------ | ----------------: | ----------------: | --------------: |
| logger     | construct logger (6 redact keys)                 |   6,315,052 ±0.9% |  56,506,177 ±0.6% | +794.8% (8.95x) |
| logger     | info, small payload                              |   1,542,447 ±0.5% |   3,936,555 ±0.4% | +155.2% (2.55x) |
| logger     | debug below min level (filtered)                 | 150,378,104 ±0.8% | 147,257,260 ±5.7% |   -2.1% (0.98x) |
| logger     | info, nested payload + 6 redact keys             |     433,042 ±0.3% |     608,475 ±5.5% |  +40.5% (1.41x) |
| logger     | info, context + 6 redact keys                    |     856,331 ±0.5% |   2,556,687 ±0.5% | +198.6% (2.99x) |
| logger     | error with Error instance                        |   1,324,210 ±0.5% |   2,395,617 ±0.5% |  +80.9% (1.81x) |
| logger     | info, wide payload (50 fields)                   |     276,086 ±0.5% |     223,277 ±0.5% |  -19.1% (0.81x) |
| logger     | info, wide payload (50 fields, fast-mode object) |     926,454 ±0.5% |     598,647 ±0.5% |  -35.4% (0.65x) |
| middleware | control: no logger middleware                    |     602,405 ±0.6% |     600,316 ±2.1% |   -0.3% (1.00x) |
| middleware | silent, no logs                                  |     351,373 ±0.5% |     462,240 ±0.9% |  +31.6% (1.32x) |
| middleware | silent, 3 handler logs + redact                  |     142,539 ±0.6% |     217,416 ±1.1% |  +52.5% (1.53x) |
| middleware | access log                                       |     249,965 ±0.5% |     247,297 ±5.9% |   -1.1% (0.99x) |
| middleware | access log + 15 headers + cf + redact            |      83,560 ±0.5% |      92,410 ±0.7% |  +10.6% (1.11x) |
| middleware | error mode, thrown error                         |     138,523 ±1.4% |     138,054 ±0.8% |   -0.3% (1.00x) |

## Reading the numbers

- **Log calls are 1.3x–2.1x faster in Node and 1.4x–3x faster in workerd.**
  Redaction config is resolved once instead of per call, the logger context is
  sanitized once in `setContext()` instead of on every entry
  (`context + 6 redact keys`: +106% / +199%), and ISO timestamps are cached
  per millisecond. The workerd `construct` figure (9x) mostly measures an
  allocation the optimizer can now drop; treat it as an artifact. Node's +71%
  is the realistic number. Filtered calls (`debug below min level`) were
  already nearly free in workerd and stay that way.
- **Middleware that logs is 1.1x–1.5x faster.** Request metadata (headers,
  `cf`, route) is built on the first log call and reused
  (`silent, 3 handler logs`: +49% / +53%). Requests that never log don't pay
  for it at all (`silent, no logs`: +12% / +32%).
- **Automatic entries cost the same as in 0.1** (`access log` +12% / −1%,
  `error mode` +4% / 0%), even though 0.2 does more per entry: status-based
  levels, `req.route`, the `err` cause chain, and a trace id.
- **Wide payloads are slower: −18% to −35%.** 0.1 skipped every check when
  `redactKeys` was empty and relied on `JSON.stringify` alone, which throws on
  BigInt or circular data and never truncates. 0.2 always walks the payload
  once so an entry is always safe to write and stays under the Workers Logs
  256 KB limit. The walk costs roughly 5–10 ns per field, and a 50-field
  payload is where it shows, because 0.1's own overhead there was near zero. A
  `for...in`-based walk was tried: it was 4x faster on a single object shape in
  isolation, but made no difference in this mixed-shape benchmark and was
  slower on dictionary-mode objects, so it was not kept.

## Bundle size

### The package on its own

Minified + gzip, with `hono` external (`npm run size`):

| Entry                            | 0.1.0-beta.1 | 0.2.0-beta.0 |  Budget |
| -------------------------------- | -----------: | -----------: | ------: |
| `hono-cloudflare-logger`         |      1,615 B |      5,072 B | 5,120 B |
| `hono-cloudflare-logger/context` |            — |      3,499 B | 4,096 B |

`./context` shares a chunk with the root entry, so importing both costs little
more than the root alone. The growth comes from the new features: error cause
chains, W3C `traceparent`, buffering, sampling, the sanitize pass and the
pretty formatter. CI fails when an entry goes over budget.

### What it adds to a Worker

A one-route Hono 4.13.9 app, bundled with esbuild the way Wrangler does, with
and without the logger. Wrangler doesn't minify unless you pass `--minify` (or
set `"minify": true`), so both columns are shown. Cloudflare measures the
script size limit after compression.

| Bundle                                                  | min + gzip | Wrangler default (gzip) |
| ------------------------------------------------------- | ---------: | ----------------------: |
| Hono app, no logger                                     |    7,746 B |                15,200 B |
| added by Hono's built-in `hono/logger` (for comparison) |     +474 B |                  +716 B |
| added by `hono-cloudflare-logger` 0.1.0-beta.1          |   +1,407 B |                +1,709 B |
| added by `hono-cloudflare-logger` 0.2.0-beta.0          |   +4,782 B |                +7,453 B |
| added by 0.2.0-beta.0 with `getLogger()` (`./context`)  |   +4,858 B |                +7,545 B |

The last row is measured against an app that already uses `contextStorage()`.
The added size is a little smaller than the package on its own because gzip
shares strings with Hono. `wrangler deploy --dry-run` for
[`examples/minimal`](examples/minimal) reports a total upload of 22.94 KiB
gzip (13.36 KiB with `--minify`), far below the 3 MB (Free) and 10 MB (Paid)
Workers limits.
