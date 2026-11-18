/**
 * Render smoke for the loader picker — the owner asked for Fabric, Forge and
 * NeoForge so mods, shaders, modpacks and texture packs can be installed, and
 * this is the surface where that happens. The rules it pins down:
 *
 *  1. the list answers from the Rust catalog (the official endpoints);
 *  2. an installed loader is a "Jogar" button, not a "Instalar" one;
 *  3. when the loaders answer with NOTHING (a version nobody supports), the
 *     owner is told so — a silently empty box is how a feature looks broken.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const catalogMock = vi.fn();

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        storage: { basePath: "/workspace" },
        java: { customJavaPath: null },
        launcher: { publicServerIds: [], ramMb: 1024 },
      },
    }),
}));

vi.mock("@/services/launcher/instanceService", () => ({
  launchGame: vi.fn(async () => ""),
}));

vi.mock("@/services/launcher/accountService", () => ({
  getStoredAccount: vi.fn(async () => null),
}));


const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  cleanup();
  catalogMock.mockReset();
  catalogMock.mockResolvedValue({
    java: [
      { loader: "Fabric", version: "0.16.5", target: "fabric-loader-0.16.5-1.20.4", installerUrl: "", installed: false, channel: "estável" },
      { loader: "Forge", version: "49.2.6", target: "1.20.4-49.2.6", installerUrl: "https://maven.minecraftforge.net/x.jar", installed: true, channel: "recomendado" },
    ],
  });
});

describe("LoaderPicker — the mod loaders of a version", () => {
  it("lists the loaders the official endpoints answer for the version", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "launcher_loader_catalog" ? catalogMock() : Promise.resolve(null),
    );
    const { LoaderPicker } = await import("./LoaderPicker");
    render(<LoaderPicker mcVersion="1.20.4" />);
    expect(await screen.findByText(/Fabric 0\.16\.5/)).toBeTruthy();
    expect(screen.getAllByText(/Forge 49\.2\.6/).length).toBeGreaterThan(0);
    // an installed loader is a PLAY button, a fresh one an INSTALL button
    expect(screen.getAllByRole("button", { name: /Jogar/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Instalar/i }).length).toBeGreaterThan(0);
  });

  it("says so when no loader exists for the version", async () => {
    catalogMock.mockResolvedValue({ java: [] });
    invokeMock.mockImplementation((command: string) =>
      command === "launcher_loader_catalog" ? catalogMock() : Promise.resolve(null),
    );
    const { LoaderPicker } = await import("./LoaderPicker");
    render(<LoaderPicker mcVersion="1.20.1" />);
    expect(await screen.findByText(/Nenhum inicializador publicado/i)).toBeTruthy();
  });
});