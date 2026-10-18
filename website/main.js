/**
 * VOXEL — website interactions.
 * Data below (shader swatches, download links) mirrors the real app:
 * swatch colors come straight from src/services/shaders/shaderStyleCatalog.ts.
 */

(() => {
  "use strict";

  const REPO = "yuaberry/voxel";
  const VERSION = "0.7.0";
  const RELEASE_BASE = `https://github.com/${REPO}/releases/download/v${VERSION}/`;
  const ALL_RELEASES = `https://github.com/${REPO}/releases`;
  // Tauri bundle naming: productName "VOXEL" (v0.2.0+ — assets are
  // VOXEL_<version>_<arch>…; verified against the tauri.conf productName).
  const PKG = "VOXEL";

  const DOWNLOADS = {
    windows: [
      ["dl-win-exe", `${PKG}_${VERSION}_x64-setup.exe`],
      ["dl-win-msi", `${PKG}_${VERSION}_x64_en-US.msi`],
    ],
    linux: [
      ["dl-linux-deb", `${PKG}_${VERSION}_amd64.deb`],
      ["dl-linux-appimage", `${PKG}_${VERSION}_amd64.AppImage`],
    ],
    macos: [
      ["dl-mac-arm", `${PKG}_${VERSION}_aarch64.dmg`],
      ["dl-mac-intel", `${PKG}_${VERSION}_x64.dmg`],
    ],
  };

  // Swatches — verbatim from shaderStyleCatalog.ts (skyTop / skyHorizon / sunColor)
  const SWATCHES = [
    { n: "Alpha Piscium", t: "#0a1440", h: "#3d5a9e", s: "#cfe0ff" },
    { n: "Derivative", t: "#4a90d9", h: "#bfe3ff", s: "#ffffff" },
    { n: "Solas", t: "#2d6cdf", h: "#ffd9a0", s: "#ffe9b0" },
    { n: "Reverie", t: "#7e9fd4", h: "#ffd6c9", s: "#fff3e0" },
    { n: "Photon", t: "#3a7bd5", h: "#cfe8ff", s: "#ffffff" },
    { n: "Kappa", t: "#4a86c8", h: "#ffe3b8", s: "#fff0c8" },
    { n: "Astralex", t: "#1b2a6e", h: "#d98fff", s: "#ffb3ff" },
    { n: "Fantasy Unbound", t: "#2f5fd0", h: "#ffc46b", s: "#ffe680" },
    { n: "Ripple", t: "#1e6fb8", h: "#a8e6ff", s: "#e8faff" },
    { n: "Complementary Reimagined", t: "#3f76c4", h: "#ffd9a8", s: "#fff0d0" },
    { n: "SEUS", t: "#2a5a9e", h: "#f0c080", s: "#ffdf9e" },
    { n: "BSL", t: "#3d7ec9", h: "#ffdcae", s: "#fff0d8" },
    { n: "Fantasy", t: "#2b66c9", h: "#ffb84d", s: "#ffdd77" },
    { n: "Bliss", t: "#3a7cc0", h: "#ffe0b0", s: "#fff2d9" },
    { n: "Spooklementary", t: "#141a2e", h: "#39435e", s: "#aab4d4" },
    { n: "E-Lite", t: "#5599dd", h: "#d6ecff", s: "#ffffff" },
    { n: "EmanRux", t: "#256d8f", h: "#ffb46b", s: "#ffd9a0" },
    { n: "Iteration T", t: "#3772b8", h: "#e8d5b5", s: "#fff4e0" },
    { n: "Sundial", t: "#3d6fae", h: "#ffc27a", s: "#ffe3a3" },
    { n: "UShader", t: "#3273c6", h: "#ffd9a3", s: "#fff0cf" },
    { n: "Verlixia", t: "#4b3a8f", h: "#b98fe0", s: "#e8d5ff" },
    { n: "Moz", t: "#6f9fd8", h: "#ffd9cf", s: "#fff5ea" },
    { n: "Nostalgia", t: "#6a8fbc", h: "#e8c9a0", s: "#ffe8c0" },
    { n: "CTR", t: "#4c9ae0", h: "#cfeaff", s: "#ffffff" },
    { n: "Adistira", t: "#1e4d8f", h: "#e0a060", s: "#ffd090" },
    { n: "Hysteria", t: "#1f66c4", h: "#ff9e5e", s: "#ffcf8e" },
    { n: "Shrimple", t: "#4688cc", h: "#d8eaff", s: "#fff8e8" },
    { n: "SuperDuperVanilla", t: "#4a90d9", h: "#c8e4ff", s: "#fff4e6" },
    { n: "Sildur's Vibrant", t: "#3d82cc", h: "#ffd8a8", s: "#fff0cf" },
    { n: "VTXS", t: "#16505e", h: "#63d8c9", s: "#c8fff0" },
    { n: "N87", t: "#4f8fd4", h: "#d4e8ff", s: "#fffdf5" },
    { n: "Vanilletix", t: "#5596da", h: "#d8eaff", s: "#fffaf0" },
  ];

  /* ---------- download links ---------- */
  for (const os of Object.keys(DOWNLOADS)) {
    for (const [id, asset] of DOWNLOADS[os]) {
      const el = document.getElementById(id);
      if (el) el.href = RELEASE_BASE + asset;
    }
  }

  /* ---------- OS detection → hero CTA + highlighted card ---------- */
  const ua = navigator.userAgent;
  let os = "windows";
  if (/Mac|iPhone|iPad/i.test(ua)) os = "macos";
  else if (/Android/i.test(ua)) os = "android";
  else if (/Linux|X11|CrOS/i.test(ua)) os = "linux";

  const osLabels = {
    windows: "Download for Windows",
    macos: "Download for macOS",
    linux: "Download for Linux",
    android: "Download for Android",
  };
  const heroLabel = document.getElementById("hero-download-label");
  const heroBtn = document.getElementById("hero-download");
  const osCards = {
    windows: `${PKG}_${VERSION}_x64-setup.exe`,
    macos: `${PKG}_${VERSION}_aarch64.dmg`,
    linux: `${PKG}_${VERSION}_amd64.AppImage`,
    android: "VOXEL-mobile-0.3.1-android.apk",
  };
  if (heroLabel) heroLabel.textContent = osLabels[os];
  if (heroBtn) heroBtn.href = RELEASE_BASE + osCards[os];
  const heroCard =
    os === "android"
      ? document.querySelector('.dl-card[data-os="android"]')
      : document.querySelector(`.dl-card[data-os="${os}"]`);
  if (heroCard) heroCard.classList.add("is-hero");

  /* ---------- shader swatch grid ---------- */
  const grid = document.getElementById("swatch-grid");
  if (grid) {
    for (const sw of SWATCHES) {
      const el = document.createElement("div");
      el.className = "swatch";
      el.title = sw.n;
      el.style.setProperty("--t", sw.t);
      el.style.setProperty("--h", sw.h);
      el.style.setProperty("--s", sw.s);
      el.innerHTML = `<div class="swatch-sky"><span class="swatch-sun"></span></div><b>${sw.n}</b>`;
      grid.appendChild(el);
    }
  }

  /* ---------- mockup shader mini-picker ---------- */
  const mpSwatches = document.getElementById("mp-swatches");
  const mpPreview = document.getElementById("mp-shader-preview");
  const mpInfo = document.querySelector(".mp-shader-info");
  if (mpSwatches && mpPreview) {
    const subset = [
      "Complementary Reimagined", "BSL", "SEUS", "Solas", "Astralex",
      "Sildur's Vibrant", "Verlixia", "Nostalgia",
    ];
    let active = 0;
    for (const [i, name] of subset.entries()) {
      const sw = SWATCHES.find((s) => s.n === name);
      if (!sw) continue;
      const el = document.createElement("div");
      el.className = "mp-sw" + (i === 0 ? " is-active" : "");
      el.title = sw.n;
      el.style.background = `linear-gradient(to bottom, ${sw.t}, ${sw.h})`;
      el.addEventListener("click", () => {
        mpSwatches.querySelectorAll(".mp-sw").forEach((n) => n.classList.remove("is-active"));
        el.classList.add("is-active");
        active = i;
        applyShader(sw);
      });
      mpSwatches.appendChild(el);
      if (i === 0) applyShader(sw);
    }
    function applyShader(sw) {
      mpPreview.style.background = `linear-gradient(to bottom, ${sw.t} 0%, ${sw.h} 100%)`;
      const sun = mpPreview.querySelector(".mp-sun");
      if (sun) {
        sun.style.background = sw.s;
        sun.style.boxShadow = `0 0 16px ${sw.s}`;
      }
      if (mpInfo) {
        mpInfo.querySelector("b").textContent = sw.n;
      }
    }
  }

  /* ---------- mockup tabs ---------- */
  const tabs = document.querySelectorAll(".mtab");
  const panels = document.querySelectorAll(".mpanel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("is-active"));
      panels.forEach((p) => p.classList.remove("is-active"));
      tab.classList.add("is-active");
      const target = document.querySelector(`.mpanel[data-panel="${tab.dataset.panel}"]`);
      if (target) target.classList.add("is-active");
    });
  });

  /* ---------- scroll reveal ---------- */
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveals = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    reveals.forEach((el) => el.classList.add("is-visible"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    reveals.forEach((el) => io.observe(el));
  }
})();
