# Benchmarks

Before/after numbers for `0.1.0-beta.1` → `0.2.0`. The same scenario file
([`bench/scenarios.ts`](bench/scenarios.ts)) runs against both versions; it
only uses API that exists in 0.1, so the comparison is like for like.

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
- **Baseline.** Generated from the 0.1 source (commit `afff1cf`) with the same
  harness, on the same machine, right before the 0.2 run. The middleware
  `control` scenario (no logger at all) is the noise check: +3.5% (Node) and
  +0.3% (workerd) between the two runs. Treat differences of a few percent as
  noise.
- **Reproduce.** `npm run bench:compare` (compares against
  `bench/results/*.baseline.json` and prints the tables below). Raw results:
  [`bench/results`](bench/results).

## Results

Environment: Apple M1, darwin 24.6.0, Node.js v24.21.0

### Node.js v24.21.0

| Group      | Scenario                                         |   Before (ops/s) |    After (ops/s) |          Change |
| ---------- | ------------------------------------------------ | ---------------: | ---------------: | --------------: |
| logger     | construct logger (6 redact keys)                 |  5,139,438 ±0.6% |  8,382,199 ±1.3% |  +63.1% (1.63x) |
| logger     | info, small payload                              |  1,124,908 ±0.2% |  2,028,565 ±0.2% |  +80.3% (1.80x) |
| logger     | debug below min level (filtered)                 | 23,530,548 ±0.1% | 31,050,771 ±0.3% |  +32.0% (1.32x) |
| logger     | info, nested payload + 6 redact keys             |    334,221 ±0.3% |    456,390 ±0.2% |  +36.6% (1.37x) |
| logger     | info, context + 6 redact keys                    |    676,931 ±0.3% |  1,470,640 ±0.2% | +117.3% (2.17x) |
| logger     | error with Error instance                        |    440,173 ±0.2% |    529,909 ±0.2% |  +20.4% (1.20x) |
| logger     | info, wide payload (50 fields)                   |    257,345 ±0.2% |    219,231 ±0.2% |  -14.8% (0.85x) |
| logger     | info, wide payload (50 fields, fast-mode object) |    440,591 ±0.2% |    367,443 ±0.2% |  -16.6% (0.83x) |
| middleware | control: no logger middleware                    |    503,850 ±1.9% |    521,646 ±0.4% |   +3.5% (1.04x) |
| middleware | silent, no logs                                  |    353,405 ±0.6% |    415,302 ±0.4% |  +17.5% (1.18x) |
| middleware | silent, 3 handler logs + redact                  |    125,652 ±0.4% |    187,466 ±0.3% |  +49.2% (1.49x) |
| middleware | access log                                       |    222,024 ±0.5% |    241,837 ±0.3% |   +8.9% (1.09x) |
| middleware | access log + 15 headers + cf + redact            |    125,161 ±0.4% |    155,923 ±0.3% |  +24.6% (1.25x) |
| middleware | error mode, thrown error                         |    139,426 ±0.4% |    144,115 ±0.3% |   +3.4% (1.03x) |

### workerd (Miniflare)

| Group      | Scenario                                         |    Before (ops/s) |     After (ops/s) |          Change |
| ---------- | ------------------------------------------------ | ----------------: | ----------------: | --------------: |
| logger     | construct logger (6 redact keys)                 |   6,331,038 ±0.7% |  56,797,721 ±0.4% | +797.1% (8.97x) |
| logger     | info, small payload                              |   1,520,855 ±0.4% |   3,944,540 ±0.5% | +159.4% (2.59x) |
| logger     | debug below min level (filtered)                 | 148,186,775 ±0.6% | 148,069,592 ±0.4% |   -0.1% (1.00x) |
| logger     | info, nested payload + 6 redact keys             |     425,854 ±0.6% |     602,379 ±1.8% |  +41.5% (1.41x) |
| logger     | info, context + 6 redact keys                    |     834,030 ±1.7% |   2,547,677 ±0.2% | +205.5% (3.05x) |
| logger     | error with Error instance                        |   1,282,790 ±0.7% |   2,407,454 ±0.2% |  +87.7% (1.88x) |
| logger     | info, wide payload (50 fields)                   |     277,797 ±0.3% |     224,000 ±0.3% |  -19.4% (0.81x) |
| logger     | info, wide payload (50 fields, fast-mode object) |     932,459 ±0.5% |     608,083 ±0.4% |  -34.8% (0.65x) |
| middleware | control: no logger middleware                    |     610,296 ±0.8% |     612,270 ±0.7% |   +0.3% (1.00x) |
| middleware | silent, no logs                                  |     352,421 ±0.8% |     462,634 ±0.9% |  +31.3% (1.31x) |
| middleware | silent, 3 handler logs + redact                  |     144,216 ±1.0% |     224,490 ±0.8% |  +55.7% (1.56x) |
| middleware | access log                                       |     247,136 ±0.8% |     255,556 ±0.5% |   +3.4% (1.03x) |
| middleware | access log + 15 headers + cf + redact            |      80,177 ±6.1% |      94,248 ±0.7% |  +17.6% (1.18x) |
| middleware | error mode, thrown error                         |     134,727 ±1.4% |     144,939 ±0.4% |   +7.6% (1.08x) |

## Reading the numbers

- **Log calls are 1.2x–2.2x faster in Node and 1.4x–3x faster in workerd.**
  Redaction config is resolved once instead of per call, the logger context is
  sanitized once in `setContext()` instead of on every entry
  (`context + 6 redact keys`: +117% / +206%), and ISO timestamps are cached
  per millisecond. The workerd `construct` figure (9x) mostly measures an
  allocation the optimizer can now drop; treat it as an artifact. Node's +63%
  is the realistic number.
- **Middleware that logs is 1.2x–1.6x faster.** Request metadata (headers,
  `cf`, route) is built on the first log call and reused. Requests that never
  log don't pay for it at all (`silent, no logs`: +18% / +31%).
- **Automatic entries are flat to slightly faster** (`access log` +9% / +3%,
  `error mode` +3% / +8%), even though 0.2 does more per entry: status-based
  levels, `req.route`, the `err` cause chain, and a trace id.
- **Wide payloads are slower: −15% to −35%.** 0.1 skipped every check when
  `redactKeys` was empty and relied on `JSON.stringify` alone, which throws on
  BigInt or circular data and never truncates. 0.2 always walks the payload
  once so an entry is always safe to write and stays under the Workers Logs
  256 KB limit. The walk costs roughly 5–10 ns per field, and a 50-field
  payload is where it shows, because 0.1's own overhead there was near zero. A
  `for...in`-based walk was tried: it was 4x faster on a single object shape in
  isolation, but made no difference in this mixed-shape benchmark and was
  slower on dictionary-mode objects, so it was not kept.

## Bundle size

Minified + gzip, with `hono` external (`npm run size`):

| Entry                            | 0.1.0-beta.1 |   0.2.0 |  Budget |
| -------------------------------- | -----------: | ------: | ------: |
| `hono-cloudflare-logger`         |      1,615 B | 4,737 B | 5,120 B |
| `hono-cloudflare-logger/context` |            — | 3,313 B | 4,096 B |

`./context` shares a chunk with the root entry, so importing both costs little
more than the root alone. The growth comes from the new features: error cause
chains, W3C `traceparent`, buffering, sampling, the sanitize pass and the
pretty formatter. CI fails when an entry goes over budget.
