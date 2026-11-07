import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  fetch: vi.fn(),
  elyClientId: "configured-client",
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: state.fetch,
}));

vi.mock("@/services/secrets/secretsService", () => ({
  secretsGet: vi.fn(async (key: string) => state.secrets.get(key) ?? null),
  secretsSet: vi.fn(async (key: string, value: string) => {
    state.secrets.set(key, value);
    return { success: true, backend: "os-keyring" };
  }),
  secretsHas: vi.fn(async (key: string) => state.secrets.has(key)),
  secretsDelete: vi.fn(async (key: string) => {
    state.secrets.delete(key);
    return { success: true, backend: "os-keyring" };
  }),
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      settings: {
        launcher: {
          clientId: "",
          elyClientId: state.elyClientId,
          ramMb: 4096,
        },
      },
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { secretsSet } from "@/services/secrets/secretsService";
import {
  ELYBY_SCOPES,
  getStoredElybyAccount,
  normalizeMinecraftUuid,
  refreshElybyAccount,
  signInWithElyby,
  signOutElyby,
} from "./elyAuthService";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn(async () => JSON.stringify(body)),
  };
}

/** Device code → token → profile, the three calls of a successful sign-in. */
function mockDeviceFlow() {
  state.fetch
    .mockResolvedValueOnce(
      jsonResponse({
        device_code: "device-code",
        user_code: "ABCD-EFGH",
        verification_uri: "https://account.ely.by/code",
        interval: 1,
        expires_in: 600,
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        access_token: "ely-access-token",
        refresh_token: "ely-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        id: "ffc8fdc95824509e8a57c99b940fb996",
        name: "ElyPlayer",
      }),
    );
}

/** Simulates the user cancelling while the session is being written. */
function abortDuringFinalWrites(controller: AbortController) {
  const write = vi.mocked(secretsSet).getMockImplementation();
  if (!write) throw new Error("The secrets writer mock is missing.");
  vi.mocked(secretsSet).mockImplementation(
    async (key: string, value: string) => {
      const result = await write(key, value);
      if (key === "ely_access_token") controller.abort();
      return result;
    },
  );
}

describe("Ely.by OAuth device flow", () => {
  beforeEach(() => {
    state.secrets.clear();
    state.fetch.mockReset();
    state.elyClientId = "configured-client";
    // Restore the default writer so a test that hooks it cannot leak.
    vi.mocked(secretsSet).mockImplementation(
      async (key: string, value: string) => {
        state.secrets.set(key, value);
        return { success: true, backend: "os-keyring" };
      },
    );
    vi.useFakeTimers();
  });

  it("normalizes only valid Minecraft UUIDs", () => {
    expect(normalizeMinecraftUuid("FFC8FDC95824509E8A57C99B940FB996")).toBe(
      "ffc8fdc9-5824-509e-8a57-c99b940fb996",
    );
    expect(normalizeMinecraftUuid("ffc8fdc9-5824-509e-8a57-c99b940fb996")).toBe(
      "ffc8fdc9-5824-509e-8a57-c99b940fb996",
    );
    expect(() => normalizeMinecraftUuid("not-a-uuid")).toThrow(/invalid/i);
  });

  it("completes device flow and stores Ely.by tokens exclusively", async () => {
    state.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: "device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://account.ely.by/code",
          verification_uri_complete: "https://account.ely.by/code?user_code=ABCD-EFGH",
          interval: 1,
          expires_in: 600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "ely-access-token",
          refresh_token: "ely-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "ffc8fdc95824509e8a57c99b940fb996",
          name: "ElyPlayer",
        }),
      );

    const signIn = signInWithElyby(() => {});
    await vi.runAllTimersAsync();
    const account = await signIn;

    expect(account).toMatchObject({
      provider: "elyby",
      username: "ElyPlayer",
      uuid: "ffc8fdc9-5824-509e-8a57-c99b940fb996",
      accessToken: "ely-access-token",
    });

    const deviceCall = state.fetch.mock.calls[0];
    const deviceParams = new URLSearchParams(deviceCall[1].body);
    expect(deviceParams.get("client_id")).toBe("configured-client");
    expect(deviceParams.get("scope")).toBe(ELYBY_SCOPES);

    const tokenCall = state.fetch.mock.calls[1];
    const tokenParams = new URLSearchParams(tokenCall[1].body);
    expect(tokenParams.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:device_code",
    );
    expect(tokenParams.get("device_code")).toBe("device-code");

    const profileCall = state.fetch.mock.calls[2];
    expect(profileCall[1].headers.Authorization).toBe("Bearer ely-access-token");

    expect(state.secrets.get("ely_access_token")).toBe("ely-access-token");
    expect(state.secrets.get("ely_refresh_token")).toBe("ely-refresh-token");
    expect(state.secrets.get("mc_active_provider")).toBe("elyby");
    expect(state.secrets.has("mc_access_token")).toBe(false);
    expect(await getStoredElybyAccount()).toMatchObject({
      provider: "elyby",
      username: "ElyPlayer",
    });
  });

  it("keeps polling while Ely.by reports authorization_pending", async () => {
    state.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: "device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://account.ely.by/code",
          interval: 1,
          expires_in: 600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "authorization_pending",
            error_description: "The user has not approved the device yet.",
          },
          400,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "approved-token",
          refresh_token: "approved-refresh",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "00112233445566778899aabbccddeeff",
          name: "ApprovedPlayer",
        }),
      );

    const signIn = signInWithElyby(() => {});
    await vi.runAllTimersAsync();
    const account = await signIn;

    expect(account.accessToken).toBe("approved-token");
    expect(state.fetch).toHaveBeenCalledTimes(4);
  });

  it("increases the polling interval after slow_down", async () => {
    state.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: "device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://account.ely.by/code",
          interval: 1,
          expires_in: 600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "slow_down",
            error_description: "Polling too quickly.",
          },
          400,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "approved-token",
          refresh_token: "approved-refresh",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "00112233445566778899aabbccddeeff",
          name: "ApprovedPlayer",
        }),
      );

    const signIn = signInWithElyby(() => {});
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(state.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await signIn;

    expect(state.fetch).toHaveBeenCalledTimes(4);
  });

  it("aborts polling and stores no credentials when cancelled", async () => {
    state.fetch.mockResolvedValueOnce(
      jsonResponse({
        device_code: "device-code",
        user_code: "ABCD-EFGH",
        verification_uri: "https://account.ely.by/code",
        interval: 5,
        expires_in: 600,
      }),
    );
    const controller = new AbortController();

    const signIn = signInWithElyby(() => controller.abort(), {
      signal: controller.signal,
    });
    const rejection = expect(signIn).rejects.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();

    await rejection;
    expect(state.secrets.has("ely_access_token")).toBe(false);
    expect(state.secrets.has("mc_active_provider")).toBe(false);
  });

  it("rolls back the session when cancelled during the final writes", async () => {
    mockDeviceFlow();
    state.secrets.set("mc_active_provider", "microsoft");
    const controller = new AbortController();
    abortDuringFinalWrites(controller);

    const signIn = signInWithElyby(() => {}, { signal: controller.signal });
    const rejection = expect(signIn).rejects.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();

    await rejection;
    expect(state.secrets.has("ely_username")).toBe(false);
    expect(state.secrets.has("ely_access_token")).toBe(false);
    expect(state.secrets.has("ely_refresh_token")).toBe(false);
    expect(state.secrets.has("ely_client_id")).toBe(false);
    // The previous provider selection survives the cancelled sign-in.
    expect(state.secrets.get("mc_active_provider")).toBe("microsoft");
  });

  it("leaves no provider selection after a cancelled first sign-in", async () => {
    mockDeviceFlow();
    const controller = new AbortController();
    abortDuringFinalWrites(controller);

    const signIn = signInWithElyby(() => {}, { signal: controller.signal });
    const rejection = expect(signIn).rejects.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();

    await rejection;
    expect(state.secrets.has("ely_access_token")).toBe(false);
    expect(state.secrets.has("mc_active_provider")).toBe(false);
  });

  it("revokes the remote grant and always clears local Ely.by credentials", async () => {
    state.secrets.set("ely_username", "ElyPlayer");
    state.secrets.set("ely_uuid", "ffc8fdc95824509e8a57c99b940fb996");
    state.secrets.set("ely_access_token", "old-access");
    state.secrets.set("ely_token_expiry", "1");
    state.secrets.set("ely_refresh_token", "stored-refresh");
    state.secrets.set("ely_client_id", "stored-client");
    state.fetch.mockResolvedValueOnce(jsonResponse({}));

    const result = await signOutElyby();

    expect(result.remoteRevoked).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(state.secrets.has("ely_access_token")).toBe(false);
    expect(state.secrets.has("ely_refresh_token")).toBe(false);
    const revokeParams = new URLSearchParams(state.fetch.mock.calls[0][1].body);
    expect(revokeParams.get("token")).toBe("stored-refresh");
    expect(revokeParams.get("client_id")).toBe("stored-client");
    expect(revokeParams.get("token_type_hint")).toBe("refresh_token");
  });

  it("clears local Ely.by credentials even when remote revocation fails", async () => {
    state.secrets.set("ely_access_token", "old-access");
    state.secrets.set("ely_refresh_token", "stored-refresh");
    state.secrets.set("ely_client_id", "stored-client");
    state.fetch.mockRejectedValueOnce(new Error("network unavailable"));

    const result = await signOutElyby();

    expect(result.remoteRevoked).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/could not revoke/i);
    expect(state.secrets.has("ely_access_token")).toBe(false);
    expect(state.secrets.has("ely_refresh_token")).toBe(false);
  });

  it("reports no remote revocation when no grant exists", async () => {
    const result = await signOutElyby();

    expect(result.remoteRevoked).toBe(false);
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.secrets.has("mc_active_provider")).toBe(false);
  });

  it("refreshes with the client id that owns the stored session", async () => {
    state.secrets.set("ely_username", "ElyPlayer");
    state.secrets.set("ely_uuid", "ffc8fdc9-5824-509e-8a57-c99b940fb996");
    state.secrets.set("ely_access_token", "old-access");
    state.secrets.set("ely_token_expiry", "1");
    state.secrets.set("ely_refresh_token", "stored-refresh");
    state.secrets.set("ely_client_id", "stored-client");
    state.fetch.mockResolvedValueOnce(
      jsonResponse({
        access_token: "new-access",
        expires_in: 3600,
      }),
    );

    const account = await refreshElybyAccount();

    expect(account.accessToken).toBe("new-access");
    expect(state.secrets.get("ely_access_token")).toBe("new-access");
    expect(state.secrets.get("ely_refresh_token")).toBe("stored-refresh");

    const params = new URLSearchParams(state.fetch.mock.calls[0][1].body);
    expect(params.get("client_id")).toBe("stored-client");
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("stored-refresh");
  });

  it("does not let a late refresh overwrite a newer sign-in session", async () => {
    state.secrets.set("ely_username", "OldPlayer");
    state.secrets.set("ely_uuid", "11111111111111111111111111111111");
    state.secrets.set("ely_access_token", "old-access");
    state.secrets.set("ely_token_expiry", "1");
    state.secrets.set("ely_refresh_token", "old-refresh");
    state.secrets.set("ely_client_id", "stored-client");

    let resolveRefresh!: (value: ReturnType<typeof jsonResponse>) => void;
    state.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    const refresh = refreshElybyAccount();
    await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());

    // A newer sign-in commits while the refresh request is still in flight.
    state.secrets.set("ely_username", "NewPlayer");
    state.secrets.set("ely_uuid", "22222222222222222222222222222222");
    state.secrets.set("ely_access_token", "new-access");
    resolveRefresh(
      jsonResponse({
        access_token: "stale-refreshed-access",
        expires_in: 3600,
      }),
    );

    await expect(refresh).rejects.toMatchObject({ name: "AbortError" });
    expect(state.secrets.get("ely_access_token")).toBe("new-access");
    expect(state.secrets.get("ely_username")).toBe("NewPlayer");
  });
});
