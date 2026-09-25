import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/context.ts"],
  format: "esm",
  platform: "neutral",
  target: "es2022",
  // Keep `dist/*.js` / `dist/*.d.ts`, matching the `exports` map.
  fixedExtension: false,
  // Declarations come from oxc's isolated-declarations emitter, so the build
  // doesn't depend on the TypeScript JS API (absent in TypeScript 7). The
  // explicit return types JSR requires are what make this possible.
  dts: { generator: "oxc" },
  clean: true,
});
