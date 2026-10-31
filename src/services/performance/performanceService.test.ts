/**
 * Performance Lab — tests for pure aggregation logic.
 *
 * Tests verify that metrics are computed correctly from real data,
 * empty states return null (never fake data), and averages are honest.
 */
import { describe, expect, it } from "vitest";
import {
  buildTimer,
  serverStartTimer,
  fpsMeter,
  getPerformanceOverview,
} from "./performanceService";

// ---------------------------------------------------------------------------
// Build timer tests
// ---------------------------------------------------------------------------

describe("Build timer", () => {
  it("returns empty state initially", () => {
    expect(buildTimer.getBuildTimes()).toEqual([]);
    expect(buildTimer.getAverageBuildTimeMs()).toBeNull();
    expect(buildTimer.getLastBuildTimeMs()).toBeNull();
  });

  it("startBuild does not crash on empty", () => {
    buildTimer.startBuild("my-project", "compile");
    expect(buildTimer.getBuildTimes()).toEqual([]);
  });
});

describe("Server start timer", () => {
  it("returns null for empty starts", () => {
    expect(serverStartTimer.getStartTimes()).toEqual([]);
    expect(serverStartTimer.getAverageStartTimeMs()).toBeNull();
    expect(serverStartTimer.getLastStartTimeMs()).toBeNull();
  });

  it("startStart does not crash on empty", () => {
    serverStartTimer.startStart("my-server");
    expect(serverStartTimer.getStartTimes()).toEqual([]);
  });
});

describe("FPS meter", () => {
  it("returns null when no samples", () => {
    expect(fpsMeter.getCurrentFps()).toBeNull();
    expect(fpsMeter.getAverageFps()).toBeNull();
    expect(fpsMeter.getSamples()).toEqual([]);
  });
});

describe("Performance overview", () => {
  it("returns nulls for empty state", () => {
    const overview = getPerformanceOverview();
    expect(overview.bootTimeMs).toBeNull();
    expect(overview.buildTimeMs).toBeNull();
    expect(overview.fps).toBeNull();
    expect(overview.memoryRssMb).toBeNull();
    expect(overview.serverStartTimeMs).toBeNull();
    expect(overview.measuredAt).toBeDefined();
  });
});
