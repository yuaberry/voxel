import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: [
      "src/**/*.test.{ts,tsx}",
      "packages/core/src/**/*.test.ts",
    ],
    environment: "node",
    // Heavy Tauri dialogs are imported dynamically inside their tests; 5s is
    // tight even on an idle machine (4.1s measured) and a timeout used to let
    // the late render leak into the next test (duplicate "Server name").
    // 30s also survives a developer running the suite while cargo compiles.
    testTimeout: 30_000,
    // render smoke tests run in a DOM — they prove the dialogs actually
    // render instead of dying inside the overlay (the owner's "only a
    // scrollbar appears and nothing happens" report)
    environmentMatchGlobs: [
      ["**/*.render.test.tsx", "jsdom"],
    ],
  },
});
