import { afterAll, bench, describe } from "vitest";
import { consumeSinkBytes, createScenarios, installConsoleSink } from "./scenarios.ts";

const restoreConsole = installConsoleSink();
const scenarios = createScenarios();

afterAll(() => {
  consumeSinkBytes();
  restoreConsole();
});

for (const group of ["logger", "middleware"] as const) {
  describe(group, () => {
    for (const scenario of scenarios) {
      if (scenario.group === group) {
        // tinybench awaits returned promises itself; sync scenarios stay sync.
        bench(scenario.name, scenario.fn as () => void, { time: 1000, warmupTime: 200 });
      }
    }
  });
}
