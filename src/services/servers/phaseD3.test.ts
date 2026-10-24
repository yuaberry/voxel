/**
 * Backup Pro (§21) — the tests: the pure scheduling decision over real
 * compact stamps, and the scheduler loop's honesty rules (running server
 * is skipped, no schedule is skipped, failures alert instead of hiding).
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BACKUPS_CONFIG,
  nextBackupDue,
  parseBackupStamp,
  startBackupScheduler,
  tick,
  type BackupsConfig,
  type SchedulerDeps,
} from "./backupPro";

const schedule = (hours: number): BackupsConfig => ({
  maxKeep: 0,
  maxAgeDays: 0,
  scheduleHours: hours,
});

describe("Backup Pro — scheduling math (§21)", () => {
  it("parses compact stamps the same way the Rust side writes them", () => {
    const ms = parseBackupStamp("20261024-50000");
    expect(ms).not.toBeNull();
    expect(new Date(ms!).toISOString()).toContain("2026-10-24");
    // 50000 seconds into the day = 13:53:20 UTC
    expect(new Date(ms!).toISOString()).toContain("13:53:20");
    expect(parseBackupStamp("garbage")).toBeNull();
    expect(parseBackupStamp("20261024")).toBeNull(); // missing the seconds-of-day part
  });

  it("is never due without a schedule", () => {
    const result = nextBackupDue(
      [{ createdAt: "20200101-00000" }],
      DEFAULT_BACKUPS_CONFIG,
      Date.UTC(2026, 9, 24),
    );
    expect(result.due).toBe(false);
  });

  it("a scheduled server with zero backups is due immediately", () => {
    const result = nextBackupDue([], schedule(24), Date.UTC(2026, 9, 24));
    expect(result.due).toBe(true);
    expect(result.lastAt).toBeNull();
  });

  it("due when the newest backup is older than the schedule window", () => {
    const now = Date.UTC(2026, 9, 24, 12); // 2026-10-24 noon
    // 25 hours before now → 2026-10-23 11:00 → stamp of that moment
    const older = new Date(now - 25 * 3_600_000);
    const stamp = `${older.getUTCFullYear()}${String(older.getUTCMonth() + 1).padStart(2, "0")}${String(
      older.getUTCDate(),
    ).padStart(2, "0")}-${String(
      older.getUTCHours() * 3600 + older.getUTCMinutes() * 60 + older.getUTCSeconds(),
    ).padStart(5, "0")}`;
    const due = nextBackupDue([{ createdAt: stamp }], schedule(24), now);
    expect(due.due).toBe(true);
    expect(due.hoursSince).toBeGreaterThanOrEqual(25);

    const fresh = new Date(now - 2 * 3_600_000);
    const freshStamp = `${fresh.getUTCFullYear()}${String(fresh.getUTCMonth() + 1).padStart(2, "0")}${String(
      fresh.getUTCDate(),
    ).padStart(2, "0")}-${String(
      fresh.getUTCHours() * 3600 + fresh.getUTCMinutes() * 60 + fresh.getUTCSeconds(),
    ).padStart(5, "0")}`;
    const notDue = nextBackupDue([{ createdAt: freshStamp }], schedule(24), now);
    expect(notDue.due).toBe(false);
    expect(notDue.hoursSince).toBeLessThan(3);
  });

  it("an unparsable stamp is treated as no backup — due, not stuck", () => {
    const result = nextBackupDue([{ createdAt: "not-a-stamp" }], schedule(24), Date.now());
    expect(result.due).toBe(true);
  });
});

describe("Backup Pro — the scheduler loop (§21)", () => {
  const makeDeps = (overrides: Partial<SchedulerDeps>): SchedulerDeps => ({
    listServers: async () => [{ slug: "arena" }],
    isRunning: async () => false,
    loadConfig: async () => schedule(24),
    listBackups: async () => [],
    backupNow: async () => undefined,
    notify: () => undefined,
    now: () => Date.now(),
    ...overrides,
  });

  it("backs up a stopped server whose schedule window elapsed", async () => {
    const backupNow = vi.fn().mockResolvedValue(undefined);
    await tick(makeDeps({ backupNow }));
    expect(backupNow).toHaveBeenCalledWith("arena");
  });

  it("never touches a running server — world safety is a skip, not an alert", async () => {
    const backupNow = vi.fn();
    const notify = vi.fn();
    await tick(makeDeps({ isRunning: async () => true, backupNow, notify }));
    expect(backupNow).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("skips servers without a schedule and servers not due yet", async () => {
    const backupNow = vi.fn();
    // no schedule
    await tick(makeDeps({ loadConfig: async () => DEFAULT_BACKUPS_CONFIG, backupNow }));
    expect(backupNow).not.toHaveBeenCalled();
    // not due: fresh backup, 1h schedule, backup 2 minutes old
    const freshStamp = (() => {
      const now = new Date();
      return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
        now.getUTCDate(),
      ).padStart(2, "0")}-${String(
        now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds(),
      ).padStart(5, "0")}`;
    })();
    await tick(
      makeDeps({ listBackups: async () => [{ createdAt: freshStamp }], backupNow }),
    );
    expect(backupNow).not.toHaveBeenCalled();
  });

  it("a failed scheduled backup alerts the owner instead of failing silently", async () => {
    const notify = vi.fn();
    const backupNow = vi.fn().mockRejectedValue(new Error("disk full"));
    await tick(makeDeps({ backupNow, notify }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("Scheduled backup failed");
    expect(notify.mock.calls[0][1]).toContain("arena");
  });

  it("the singleton guard returns a no-op stop when already running", () => {
    const stop = startBackupScheduler({ now: () => 0 });
    expect(typeof stop).toBe("function");
    const stop2 = startBackupScheduler({ now: () => 0 });
    // second start on a live singleton must not stack a second interval
    stop2();
    stop();
  });
});
