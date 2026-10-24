import { describe, expect, it } from "vitest";
import { evaluateQa } from "./qaLab";

describe("QA Lab — the verdict matrix never lies (§14)", () => {
  it("a green project walks the four levels with the honest runtime limit", () => {
    const verdicts = evaluateQa({
      lastBuildStatus: "success",
      consistencyIssues: 0,
      compatIncompatible: 0,
      compatWarnings: 0,
    });
    expect(verdicts.map((v) => v.level)).toEqual(["build", "checks", "runtime", "manual"]);
    expect(verdicts[0].status).toBe("passed");
    expect(verdicts[1].status).toBe("passed");
    // runtime NEVER claims to be proven — the limitation is registered
    expect(verdicts[2].status).toBe("requires-manual");
    expect(verdicts[2].registeredLimitation).toBeTruthy();
    expect(verdicts[3].status).toBe("requires-manual");
  });

  it("build success alone is NOT runtime proof — the levels stay distinct", () => {
    const verdicts = evaluateQa({
      lastBuildStatus: "success",
      consistencyIssues: 0,
      compatIncompatible: 0,
      compatWarnings: 0,
    });
    const build = verdicts.find((v) => v.level === "build")!;
    const runtime = verdicts.find((v) => v.level === "runtime")!;
    expect(build.status).toBe("passed");
    expect(runtime.status).not.toBe("passed");
    expect(runtime.label).not.toContain("Build");
  });

  it("a failed build buries the check level with an explicit 'not-run' (never a lie)", () => {
    const verdicts = evaluateQa({
      lastBuildStatus: "failed",
      consistencyIssues: 5,
      compatIncompatible: 1,
      compatWarnings: 0,
    });
    expect(verdicts.find((v) => v.level === "build")!.status).toBe("failed");
    const checks = verdicts.find((v) => v.level === "checks")!;
    expect(checks.status).toBe("not-run");
    expect(checks.detail).toContain("get the build green first");
  });

  it("never-built projects report every level honestly", () => {
    const verdicts = evaluateQa({
      lastBuildStatus: null,
      consistencyIssues: 0,
      compatIncompatible: 0,
      compatWarnings: 0,
    });
    expect(verdicts.find((v) => v.level === "build")!.status).toBe("not-run");
    expect(verdicts.find((v) => v.level === "build")!.label).toBe("Never built");
  });

  it("consistency findings and compat warnings fail the checks level with counts", () => {
    const verdicts = evaluateQa({
      lastBuildStatus: "success",
      consistencyIssues: 3,
      compatIncompatible: 0,
      compatWarnings: 2,
    });
    const checks = verdicts.find((v) => v.level === "checks")!;
    expect(checks.status).toBe("failed");
    expect(checks.detail).toContain("3 consistency");
    expect(checks.detail).toContain("2 compatibility warning");
  });

  it("hard incompatibilities beat soft findings in the message", () => {
    const verdicts = evaluateQa({
      lastBuildStatus: "success",
      consistencyIssues: 1,
      compatIncompatible: 2,
      compatWarnings: 0,
    });
    const checks = verdicts.find((v) => v.level === "checks")!;
    expect(checks.detail).toContain("2 incompatibility");
  });
});
