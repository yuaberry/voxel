import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: state.fetch,
}));

import {
  fetchTextWithTimeout,
  fetchWithTimeout,
  waitWithAbort,
} from "./oauthHttp";

describe("OAuth HTTP cancellation and deadlines", () => {
  beforeEach(() => {
    state.fetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts an in-flight request when the owner cancels", async () => {
    state.fetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const controller = new AbortController();
    const request = fetchWithTimeout(
      "https://account.ely.by/api/oauth2/v1/token",
      { method: "POST" },
      controller.signal,
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("enforces a hard timeout even when the HTTP client ignores abort", async () => {
    state.fetch.mockImplementation(
      () => new Promise(() => {}),
    );

    const request = fetchWithTimeout(
      "https://account.ely.by/api/oauth2/v1/token",
      { method: "POST" },
      undefined,
      25,
    );
    const assertion = expect(request).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("includes a stalled response body in the total deadline", async () => {
    state.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => new Promise(() => {}),
    });

    const request = fetchTextWithTimeout(
      "https://account.ely.by/api/oauth2/v1/token",
      { method: "POST" },
      undefined,
      25,
    );
    const assertion = expect(request).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("wakes a pending device-flow wait immediately on cancellation", async () => {
    const controller = new AbortController();
    const wait = waitWithAbort(60_000, controller.signal, "cancelled");
    controller.abort();

    await expect(wait).rejects.toMatchObject({ name: "AbortError" });
  });
});
