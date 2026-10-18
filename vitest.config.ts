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
    // render smoke tests run in a DOM — they prove the dialogs actually
    // render instead of dying inside the overlay (the owner's "only a
    // scrollbar appears and nothing happens" report)
    environmentMatchGlobs: [
      ["**/*.render.test.tsx", "jsdom"],
    ],
  },
});
