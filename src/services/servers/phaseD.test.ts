import { describe, expect, it } from "vitest";
import { simulateProgression, PRISON_RULES, mineForPoints, suggestParams } from "./economySimulator";
import { parseProperties, evaluateSecurity, securitySummary } from "./securityCenter";

describe("Economy Simulator — deterministic math over the module's real rules (§16)", () => {
  it("projects the rank climb using the REAL Prison constants", () => {
    const report = simulateProgression({ blocksPerMinute: 60, prestigeMultiplier: 2, coinsPerBlock: 1, dilution: 100000 });
    expect(PRISON_RULES.blocksPerPoint).toBe(10);
    expect(PRISON_RULES.prestigeAt).toBe(50);
    expect(report.ranks[0].rank).toContain("Mine A");
    expect(report.ranks[2].rank).toContain("Mine B");
    expect(report.ranks[3].rank).toContain("Mine C");
    // 100 blocks for the first rank-up at 60/min ≈ 2 minutes
    expect(report.ranks[0].minutesNeeded).toBe(2);
  });

  it("compounds prestige runs with the multiplier", () => {
    const report = simulateProgression({ blocksPerMinute: 100, prestigeMultiplier: 2, coinsPerBlock: 1, dilution: 1 });
    expect(report.prestigeRuns).toHaveLength(5);
    expect(report.prestigeRuns[0].multiplier).toBe(2);
    expect(report.prestigeRuns[1].multiplier).toBe(4);
    // 500 blocks at 200 effective blocks/min = 3 minutes; second run: 500/400 → 1 minute rounded
    expect(report.prestigeRuns[0].minutes).toBe(3);
    expect(report.prestigeRuns[1].minutes).toBeLessThanOrEqual(report.prestigeRuns[0].minutes);
  });

  it("flags the balance exploits the §16 report demands", () => {
    const report = simulateProgression({ blocksPerMinute: 30, prestigeMultiplier: 0.5, coinsPerBlock: 5000, dilution: 1 });
    expect(report.exploitFindings.some((f) => f.includes("SLOWS the grind"))).toBe(true);
    expect(report.exploitFindings.some((f) => f.includes("market tiers"))).toBe(true);
    const extreme = simulateProgression({ blocksPerMinute: 30, prestigeMultiplier: 20, coinsPerBlock: 1, dilution: 1 });
    expect(extreme.exploitFindings.some((f) => f.includes("snowballs"))).toBe(true);
  });

  it("never divides by zero — hostile input produces a finding, not a crash", () => {
    const report = simulateProgression({ blocksPerMinute: 0, prestigeMultiplier: 2, coinsPerBlock: 1, dilution: 1 });
    expect(report.exploitFindings.some((f) => f.includes("zero or less"))).toBe(true);
    expect(report.ranks.length).toBeGreaterThan(0);
  });

  it("names the bottleneck honestly per regime", () => {
    const flat = simulateProgression({ blocksPerMinute: 30, prestigeMultiplier: 1, coinsPerBlock: 1, dilution: 1 });
    expect(flat.bottleneck).toContain("no multiplier");
    const slow = simulateProgression({ blocksPerMinute: 10, prestigeMultiplier: 2, coinsPerBlock: 1, dilution: 1 });
    expect(slow.bottleneck).toContain("early grind");
  });

  it("carries the SIMULATION disclaimer and sane defaults", () => {
    const report = simulateProgression(suggestParams(null));
    expect(report.disclaimer).toContain("SIMULATION");
    expect(report.disclaimer).toContain("No real player data");
    expect(mineForPoints(0)).toBe("Mine A");
    expect(mineForPoints(15)).toBe("Mine B");
    expect(mineForPoints(40)).toBe("Mine C");
  });
});

describe("Security Center — real checks on the real files (§17)", () => {
  const baseFacts = {
    properties: { "online-mode": "true", "white-list": "false" },
    eulaAccepted: true,
    backupCount: 3,
    newestBackupAgeHours: 5,
    pluginJars: [],
  };

  it("passes a clean server but never claims full security", () => {
    const findings = evaluateSecurity(baseFacts);
    const summary = securitySummary(findings);
    expect(summary.critical).toBe(0);
    expect(summary.verdict).toContain("not a guarantee");
    expect(findings.find((f) => f.id === "online-mode")!.severity).toBe("pass");
    expect(findings.find((f) => f.id === "rcon")!.severity).toBe("pass");
  });

  it("CRITICAL: hand-edited online-mode=false is caught from the DISK", () => {
    const findings = evaluateSecurity({
      ...baseFacts,
      properties: { "online-mode": "false" },
    });
    const online = findings.find((f) => f.id === "online-mode")!;
    expect(online.severity).toBe("critical");
    expect(online.evidence).toContain("online-mode=false");
    expect(securitySummary(findings).verdict).toContain("fix before going public");
  });

  it("CRITICAL: an RCON password in plain text is named", () => {
    const findings = evaluateSecurity({
      ...baseFacts,
      properties: { "online-mode": "true", "enable-rcon": "true", "rcon.password": "hunter2" },
    });
    const rcon = findings.find((f) => f.id === "rcon")!;
    expect(rcon.severity).toBe("critical");
    expect(rcon.evidence).toContain("plain text");
  });

  it("CRITICAL: passwordless RCON is worse", () => {
    const findings = evaluateSecurity({
      ...baseFacts,
      properties: { "enable-rcon": "true" },
    });
    expect(findings.find((f) => f.id === "rcon")!.evidence).toContain("no rcon.password");
  });

  it("warns on stale and missing backups with the age in days", () => {
    const stale = evaluateSecurity({ ...baseFacts, backupCount: 2, newestBackupAgeHours: 24 * 10 });
    expect(stale.find((f) => f.id === "backups")!.severity).toBe("warning");
    expect(stale.find((f) => f.id === "backups")!.evidence).toContain("10 day");
    const none = evaluateSecurity({ ...baseFacts, backupCount: 0, newestBackupAgeHours: null });
    expect(none.find((f) => f.id === "backups")!.severity).toBe("warning");
  });

  it("lists plugin jars with the origin caveat (honest, no fake provenance)", () => {
    const findings = evaluateSecurity({ ...baseFacts, pluginJars: ["EssentialsX.jar"] });
    const plugins = findings.find((f) => f.id === "plugins")!;
    expect(plugins.severity).toBe("info");
    expect(plugins.evidence).toContain("EssentialsX.jar");
    expect(plugins.recommendation).toContain("origin");
  });

  it("parses real properties payloads (comments, spacing)", () => {
    const props = parseProperties("#Minecraft server properties\nspawn-protection=16\nonline-mode=true\n");
    expect(props["online-mode"]).toBe("true");
    expect(props["spawn-protection"]).toBe("16");
  });
});
