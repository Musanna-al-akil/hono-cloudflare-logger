import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Runs tests/workers inside workerd, the runtime Cloudflare Workers use.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-07-01",
        // AsyncLocalStorage for hono/context-storage (the ./context subpath).
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    include: ["tests/workers/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
  },
});
