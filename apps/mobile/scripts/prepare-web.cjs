#!/usr/bin/env node
/**
 * Post-processes `expo export --platform web` output into an installable
 * PWA: iOS "Add to Home Screen" metas, web manifest and touch icon.
 * Run after the export (see `pnpm build:web`).
 */

const fs = require("node:fs");
const path = require("node:path");

const distDir = path.join(__dirname, "..", "dist-web");
if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("dist-web/index.html not found — run `expo export -p web` first");
  process.exit(1);
}

const manifest = {
  name: "VOXEL",
  short_name: "VOXEL",
  description: "AI-Powered Creation Platform — mobile companion of the VOXEL desktop studio.",
  start_url: "/",
  display: "standalone",
  background_color: "#050609",
  theme_color: "#050609",
  icons: [
    {
      src: "/apple-touch-icon.png",
      sizes: "1024x1024",
      type: "image/png",
      purpose: "any",
    },
  ],
};
fs.writeFileSync(
  path.join(distDir, "manifest.webmanifest"),
  JSON.stringify(manifest, null, 2),
);
fs.copyFileSync(
  path.join(__dirname, "..", "assets", "icon.png"),
  path.join(distDir, "apple-touch-icon.png"),
);

const inject = `  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#050609">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="VOXEL">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
`;

let count = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".html")) {
      let html = fs.readFileSync(full, "utf8");
      if (!html.includes("manifest.webmanifest")) {
        html = html.replace("</head>", `${inject}</head>`);
        fs.writeFileSync(full, html);
        count++;
      }
    }
  }
};
walk(distDir);

console.log(`PWA ready: manifest + touch icon, ${count} HTML pages patched`);
