import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * The site is deployed as a GitHub Pages sub-path of the VOXEL site
 * (https://yuaberry.github.io/voxel/mine-rank/), so every asset URL is
 * relative to that folder.
 */
export default defineConfig({
  base: "/voxel/mine-rank/",
  plugins: [react()],
  resolve: {
    alias: {
      // ONE source of truth: the site renders the very same manifest that
      // generates the datapack inside the VOXEL desktop app.
      "@mine-rank": path.resolve(
        __dirname,
        "../../src/services/servers/mineRankServer.ts",
      ),
    },
  },
  server: {
    fs: {
      // the shared module lives outside the app folder
      allow: [path.resolve(__dirname, "../..")],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
