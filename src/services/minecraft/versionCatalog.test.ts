import { describe, expect, it } from "vitest";
import { isLoaderAvailable, mavenRangeFor } from "./versionCatalog";
import type { MinecraftVersionInfo } from "@/types/catalog";

const base: MinecraftVersionInfo = {
  version: "1.20.1",
  kind: "release",
  releaseTime: "",
  loaders: ["fabric", "forge", "neoforge"],
  serverSoftware: ["vanilla"],
  javaRelease: 17,
  experimental: false,
  fabric: { yarn: "1.20.1+build.10", fabricApi: "0.92.2+1.20.1", loader: "0.16.9" },
  forge: { recommended: "47.4.10" },
  neoforge: { latest: "47.1.104" },
};

describe("loader availability (live catalog truth)", () => {
  it("fabric follows the catalog loaders list", () => {
    expect(isLoaderAvailable(base, "fabric")).toBe(true);
    const noFabric = { ...base, loaders: ["forge"] as MinecraftVersionInfo["loaders"] };
    expect(isLoaderAvailable(noFabric, "fabric")).toBe(false);
  });

  it("forge needs both the loader entry and a recommended build", () => {
    expect(isLoaderAvailable(base, "forge")).toBe(true);
    expect(isLoaderAvailable({ ...base, forge: null }, "forge")).toBe(false);
  });

  it("neoforge is honest: template covers the 1.20.1 lineage only", () => {
    expect(isLoaderAvailable(base, "neoforge")).toBe(true);
    const modern = { ...base, version: "1.21.1", neoforge: { latest: "21.1.209" } };
    expect(isLoaderAvailable(modern, "neoforge")).toBe(false);
  });
});

describe("mavenRangeFor (mods.toml version ranges)", () => {
  it("minor version upper bound is exclusive", () => {
    expect(mavenRangeFor("1.20.1")).toBe("[1.20.1,1.21)");
    expect(mavenRangeFor("1.21.1")).toBe("[1.21.1,1.22)");
  });

  it("degrades safely for odd inputs", () => {
    expect(mavenRangeFor("26.3")).toBe("[26.3,26.4)");
    expect(mavenRangeFor("weird")).toBe("[weird,)");
  });
});
