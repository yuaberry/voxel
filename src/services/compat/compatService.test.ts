import { describe, expect, it } from "vitest";
import { evaluateCompatibility, type CompatCheck } from "./compatService";

const project = { name: "Dark Kingdom", minecraft_version: "1.20.1", loader: "fabric" as const };

function verdicts(checks: CompatCheck[]): Record<string, CompatCheck["verdict"]> {
  const out: Record<string, string> = {};
  for (const c of checks) out[c.id] = c.verdict;
  return out as Record<string, CompatCheck["verdict"]>;
}

describe("Compatibility Lab — verdicts come with evidence (pure rules)", () => {
  it("all green when the era, java and gradle facts line up", () => {
    const checks = evaluateCompatibility(
      project,
      {
        javaRelease: 17,
        experimental: false,
        packFormat: 15,
        templateId: "fabric-1.20.1-mod",
        loaderVersion: "0.92",
        loaderAvailable: true,
      },
      { javaMajor: 21 },
      { minecraft_version: "1.20.1", loader_version: "0.92", yarn_mappings: "1.20.1+build.10" },
    );
    const v = verdicts(checks);
    expect(v.loader).toBe("compatible");
    expect(v.java).toBe("compatible");
    expect(v.era).toBe("compatible");
    expect(v.gradle).toBe("compatible");
    // every verdict carries its evidence — the §12 rule
    for (const check of checks) {
      expect(check.evidence.length).toBeGreaterThan(10);
      if (check.verdict !== "compatible") expect(check.fix).toBeTruthy();
    }
  });

  it("flags the missing Java with the exact fix", () => {
    const checks = evaluateCompatibility(
      project,
      { javaRelease: 17, experimental: false, packFormat: 15, templateId: "t", loaderVersion: "0.92", loaderAvailable: true },
      { javaMajor: null },
      null,
    );
    const java = checks.find((c) => c.id === "java")!;
    expect(java.verdict).toBe("unknown");
    expect(java.fix).toContain("Settings → Java");
    expect(verdicts(checks).gradle).toBe("unknown");
  });

  it("incompatible Java names both versions in the evidence", () => {
    const checks = evaluateCompatibility(
      project,
      { javaRelease: 25, experimental: false, packFormat: 15, templateId: "t", loaderVersion: "1", loaderAvailable: true },
      { javaMajor: 17 },
      null,
    );
    const java = checks.find((c) => c.id === "java")!;
    expect(java.verdict).toBe("incompatible");
    expect(java.evidence).toContain("needs Java 25");
    expect(java.evidence).toContain("has Java 17");
  });

  it("warns on much-newer Java and on experimental eras", () => {
    const checks = evaluateCompatibility(
      { name: "X", minecraft_version: "1.21.8", loader: "neoforge" as const },
      { javaRelease: 21, experimental: true, packFormat: 34, templateId: "neo-mdg", loaderVersion: "21.8", loaderAvailable: true },
      { javaMajor: 30 },
      null,
    );
    expect(checks.find((c) => c.id === "java")!.verdict).toBe("warning");
    expect(checks.find((c) => c.id === "era")!.verdict).toBe("warning");
    expect(checks.find((c) => c.id === "era")!.evidence).toContain("experimental");
  });

  it("incompatible loader says WHY with the catalog evidence", () => {
    const checks = evaluateCompatibility(
      { name: "X", minecraft_version: "1.19.4", loader: "neoforge" as const },
      { javaRelease: 17, experimental: false, packFormat: 15, templateId: "t", loaderVersion: "?", loaderAvailable: false },
      { javaMajor: 21 },
      null,
    );
    const loader = checks.find((c) => c.id === "loader")!;
    expect(loader.verdict).toBe("incompatible");
    expect(loader.evidence).toContain("NO neoforge toolchain");
  });

  it("gradle.properties with empty toolchain keys is caught with the missing names", () => {
    const checks = evaluateCompatibility(
      project,
      { javaRelease: 17, experimental: false, packFormat: 15, templateId: "t", loaderVersion: "0.92", loaderAvailable: true },
      { javaMajor: 21 },
      { minecraft_version: "1.20.1", loader_version: "", yarn_mappings: "" },
    );
    const gradle = checks.find((c) => c.id === "gradle")!;
    expect(gradle.verdict).toBe("incompatible");
    expect(gradle.evidence).toContain("loader_version");
    expect(gradle.evidence).toContain("yarn_mappings");
  });
});
