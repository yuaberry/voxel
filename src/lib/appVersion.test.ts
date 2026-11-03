import { describe, expect, it } from "vitest";
import { version as packageVersion } from "../../package.json";
import { version as tauriVersion } from "../../src-tauri/tauri.conf.json";
import { APP_VERSION } from "./appVersion";

/**
 * Release guard: the sidebar said v0.30.0 while package.json/tauri.conf were
 * 0.29.0. The Tauri bundle version also feeds the release asset names, so a
 * drift here ships files labelled with a version that does not exist.
 */
describe("app version — one source of truth", () => {
  it("follows package.json", () => {
    expect(APP_VERSION).toBe(packageVersion);
  });

  it("matches tauri.conf.json (release asset naming depends on it)", () => {
    expect(tauriVersion).toBe(packageVersion);
  });
});
