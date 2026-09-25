/**
 * Runs the shared scenarios inside workerd (via Miniflare).
 *
 * workerd's `performance.now()` only has 1ms resolution, so instead of
 * per-iteration sampling each scenario is timed in batches of many
 * iterations. Throughput is reported per batch and summarized as a mean with
 * a relative margin of error, matching the fields vitest bench reports.
 */
import { consumeSinkBytes, createScenarios, installConsoleSink } from "../scenarios.ts";

interface ScenarioResult {
  group: string;
  name: string;
  hz: number;
  rme: number;
  samples: number;
}

const TARGET_BATCH_MS = 50;
const WARMUP_BATCHES = 3;
const MEASURED_BATCHES = 20;

async function runIterations(fn: () => unknown, iterations: number): Promise<number> {
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const result = fn();
    if (result instanceof Promise) {
      await result;
    }
  }
  return performance.now() - start;
}

async function calibrate(fn: () => unknown): Promise<number> {
  let iterations = 16;
  for (;;) {
    const elapsed = await runIterations(fn, iterations);
    if (elapsed >= TARGET_BATCH_MS || iterations >= 1 << 24) {
      return Math.max(1, Math.round((iterations * TARGET_BATCH_MS) / Math.max(elapsed, 1)));
    }
    iterations *= 4;
  }
}

function summarize(opsPerSecond: number[]): { hz: number; rme: number } {
  const count = opsPerSecond.length;
  const mean = opsPerSecond.reduce((sum, value) => sum + value, 0) / count;
  const variance =
    opsPerSecond.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(count - 1, 1);
  const standardError = Math.sqrt(variance) / Math.sqrt(count);
  // 95% confidence, t-distribution critical value for df = 19.
  const rme = ((standardError * 2.093) / mean) * 100;
  return { hz: mean, rme };
}

async function runAll(filter: string | null): Promise<ScenarioResult[]> {
  const restoreConsole = installConsoleSink();
  const results: ScenarioResult[] = [];

  try {
    for (const scenario of createScenarios()) {
      if (filter && !scenario.name.includes(filter)) {
        continue;
      }

      const iterations = await calibrate(scenario.fn);
      for (let batch = 0; batch < WARMUP_BATCHES; batch += 1) {
        await runIterations(scenario.fn, iterations);
      }

      const opsPerSecond: number[] = [];
      for (let batch = 0; batch < MEASURED_BATCHES; batch += 1) {
        const elapsed = await runIterations(scenario.fn, iterations);
        opsPerSecond.push((iterations * 1000) / Math.max(elapsed, 1));
      }

      results.push({
        group: scenario.group,
        name: scenario.name,
        ...summarize(opsPerSecond),
        samples: MEASURED_BATCHES,
      });
    }
  } finally {
    consumeSinkBytes();
    restoreConsole();
  }

  return results;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const filter = new URL(request.url).searchParams.get("filter");
    return Response.json(await runAll(filter));
  },
};
