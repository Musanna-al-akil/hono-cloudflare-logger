import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Runs in workerd through vitest.workers.config.ts.
    exclude: ["tests/workers/**", "node_modules/**"],
    environment: "node",
    restoreMocks: true,
    clearMocks: true,
    typecheck: {
      enabled: true,
      include: ["tests/types/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/types.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        lines: 95,
        branches: 90,
        functions: 95,
        statements: 95,
      },
    },
    benchmark: {
      include: ["bench/**/*.bench.ts"],
    },
  },
});
