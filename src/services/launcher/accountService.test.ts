import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  active: null as null | "microsoft" | "elyby",
  microsoft: null as null | {
    provider: "microsoft";
    username: string;
    uuid: string;
    accessToken: string;
    expiresAt: number;
  },
  elyby: null as null | {
    provider: "elyby";
    username: string;
    uuid: string;
    accessToken: string;
    expiresAt: number;
  },
  signOutMicrosoft: vi.fn(async () => {}),
  signOutElyby: vi.fn(
    async (): Promise<{ remoteRevoked: boolean; warnings: string[] }> => {
      // The real Ely.by sign-out clears the active provider itself, so the
      // fallback must be decided from the selection read before the sign-out.
      if (state.active === "elyby") state.active = null;
      return { remoteRevoked: true, warnings: [] };
    },
  ),
  ensureFreshElybyAccount: vi.fn(async (account: unknown) => account),
}));

vi.mock("./accountStore", () => ({
  getActiveProvider: vi.fn(async () => state.active),
  setActiveProvider: vi.fn(async (provider: "microsoft" | "elyby") => {
    state.active = provider;
  }),
  clearActiveProvider: vi.fn(async () => {
    state.active = null;
  }),
}));

vi.mock("./authService", () => ({
  getStoredMicrosoftAccount: vi.fn(async () => state.microsoft),
  signOutMicrosoft: state.signOutMicrosoft,
}));

vi.mock("./elyAuthService", () => ({
  getStoredElybyAccount: vi.fn(async () => state.elyby),
  signOutElyby: state.signOutElyby,
  ensureFreshElybyAccount: state.ensureFreshElybyAccount,
}));

import {
  activateProvider,
  getLaunchAccount,
  getStoredAccount,
  selectEffectiveProvider,
  signOutProvider,
} from "./accountService";

const microsoft = {
  provider: "microsoft" as const,
  username: "MicrosoftPlayer",
  uuid: "11111111-1111-1111-1111-111111111111",
  accessToken: "microsoft-token",
  expiresAt: Date.now() + 60_000,
};

const elyby = {
  provider: "elyby" as const,
  username: "ElyPlayer",
  uuid: "22222222-2222-2222-2222-222222222222",
  accessToken: "ely-token",
  expiresAt: 1,
};

describe("Minecraft account selection", () => {
  beforeEach(() => {
    state.active = null;
    state.microsoft = null;
    state.elyby = null;
    state.signOutMicrosoft.mockClear();
    state.signOutElyby.mockClear();
    state.ensureFreshElybyAccount.mockClear();
  });

  it("uses one effective provider for legacy and explicit selections", () => {
    expect(
      selectEffectiveProvider(null, {
        microsoft,
        elyby,
      }),
    ).toBe("microsoft");
    expect(
      selectEffectiveProvider("elyby", {
        microsoft,
        elyby,
      }),
    ).toBe("elyby");
    expect(
      selectEffectiveProvider("elyby", {
        microsoft,
        elyby: null,
      }),
    ).toBeNull();
    expect(
      selectEffectiveProvider(null, {
        microsoft: null,
        elyby,
      }),
    ).toBe("elyby");
  });

  it("uses the explicitly selected provider", async () => {
    state.active = "elyby";
    state.microsoft = microsoft;
    state.elyby = elyby;

    expect(await getStoredAccount()).toEqual(elyby);
  });

  it("keeps Microsoft as the compatibility fallback for old local sessions", async () => {
    state.active = null;
    state.microsoft = microsoft;
    state.elyby = elyby;

    expect(await getStoredAccount()).toEqual(microsoft);
  });

  it("switches the active provider without deleting either account", async () => {
    state.active = "microsoft";
    state.microsoft = microsoft;
    state.elyby = elyby;

    expect(await activateProvider("elyby")).toEqual(elyby);
    expect(state.active).toBe("elyby");
    expect(state.signOutElyby).not.toHaveBeenCalled();
    expect(state.signOutMicrosoft).not.toHaveBeenCalled();
  });

  it("signing out of Ely.by preserves Microsoft and selects it", async () => {
    state.active = "elyby";
    state.microsoft = microsoft;
    state.elyby = elyby;

    await signOutProvider("elyby");

    expect(state.signOutElyby).toHaveBeenCalledOnce();
    expect(state.signOutMicrosoft).not.toHaveBeenCalled();
    expect(state.active).toBe("microsoft");
  });

  it("keeps the active provider when the other session is signed out", async () => {
    state.active = "microsoft";
    state.microsoft = microsoft;
    state.elyby = elyby;

    await signOutProvider("elyby");

    expect(state.active).toBe("microsoft");
  });

  it("leaves no active selection when no other provider is stored", async () => {
    state.active = "elyby";
    state.microsoft = null;
    state.elyby = elyby;

    await signOutProvider("elyby");

    expect(state.active).toBeNull();
  });

  it("propagates Ely.by sign-out warnings while still selecting Microsoft", async () => {
    state.active = "elyby";
    state.microsoft = microsoft;
    state.elyby = elyby;
    state.signOutElyby.mockResolvedValueOnce({
      remoteRevoked: false,
      warnings: ["remote revocation failed"],
    });

    const result = await signOutProvider("elyby");

    expect(result.warnings).toEqual(["remote revocation failed"]);
    expect(state.active).toBe("microsoft");
  });

  it("refreshes an Ely.by account only on the explicit launch path", async () => {
    state.active = "elyby";
    state.elyby = elyby;

    await getLaunchAccount();

    expect(state.ensureFreshElybyAccount).toHaveBeenCalledWith(elyby);
  });
});
