/**
 * Session Auto-Refresh tests — pure logic tests.
 *
 * Tests verify that the session status logic works correctly:
 * - No session → null
 * - Expired session → expired = true
 * - Expiring soon (≤10 min) → isExpiring = true
 * - Valid session → authenticated = true
 */

// Mock the Tauri invoke API before importing the module under test
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { describe, expect, it, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  checkMsnaSession,
  startSessionAutoRefresh,
} from "./sessionAutoRefresh";

const mockInvoke = invoke as any;

async function mockSecretsGet(tokenVal: string | null, expiryVal: string | null) {
  mockInvoke.mockImplementation((cmd: string, args: any) => {
    if (cmd === "secrets_get") {
      if (args.key === "mc_access_token") return Promise.resolve(tokenVal);
      if (args.key === "mc_token_expiry") return Promise.resolve(expiryVal);
    }
    return Promise.resolve(null);
  });
}

describe("Session Auto-Refresh", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockInvoke.mockReset();
  });

  it("returns null when no session exists", async () => {
    await mockSecretsGet(null, null);
    const status = await checkMsnaSession();
    expect(status).toBeNull();
  });

  it("returns expired status when token has expired", async () => {
    const past = Date.now() - 60000; // 1 minute ago
    await mockSecretsGet("some_token", String(past));
    const status = await checkMsnaSession();
    expect(status).not.toBeNull();
    expect(status!.authenticated).toBe(false);
    expect(status!.isExpired).toBe(true);
    expect(status!.minutesRemaining).toBe(0);
  });

  it("returns expiring soon when ≤10 minutes remaining", async () => {
    const soon = Date.now() + 5 * 60000 + 30000; // 5.5 minutes from now
    await mockSecretsGet("some_token", String(soon));
    const status = await checkMsnaSession();
    expect(status).not.toBeNull();
    expect(status!.authenticated).toBe(true);
    expect(status!.isExpiring).toBe(true);
    expect(status!.isExpired).toBe(false);
    expect(status!.minutesRemaining).toBeGreaterThanOrEqual(4);
    expect(status!.minutesRemaining).toBeLessThanOrEqual(6);
  });

  it("returns valid session when token is fresh", async () => {
    const future = Date.now() + 60 * 60000; // 1 hour from now
    await mockSecretsGet("some_token", String(future));
    const status = await checkMsnaSession();
    expect(status).not.toBeNull();
    expect(status!.authenticated).toBe(true);
    expect(status!.isExpiring).toBe(false);
    expect(status!.isExpired).toBe(false);
    expect(status!.minutesRemaining).toBe(60);
  });

  it("startSessionAutoRefresh returns a stop function", () => {
    const stop = startSessionAutoRefresh();
    expect(typeof stop).toBe("function");
    stop();
  });

  it("startSessionAutoRefresh is idempotent (calling twice doesn't double-interval)", () => {
    const stop1 = startSessionAutoRefresh();
    const stop2 = startSessionAutoRefresh();
    stop1();
    stop2();
  });
});
