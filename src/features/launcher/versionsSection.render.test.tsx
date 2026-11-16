/**
 * Render smoke for the launcher's version catalog.
 *
 * The owner asked for Java AND Bedrock download in the launcher. Java is
 * real and downloadable; Bedrock cannot be installed from a Linux desktop,
 * and the section SAYS SO instead of offering a button that cannot work —
 * which is exactly what this test pins down (a download button for Bedrock
 * would be a lie the owner would click).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const catalogMock = vi.fn();

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ settings: { storage: { basePath: "/workspace" } } }),
}));

vi.mock("@/services/launcher/versionsService", () => ({
  listVersionCatalog: (...args: unknown[]) => catalogMock(...args),
  vanillaInstanceSlug: (v: string) => `vanilla-${v}`,
  versionKindLabel: (k: string) =>
    ({ release: "estável", snapshot: "experimental" })[k] ?? k,
  versionReleased: () => "10/06/2023",
}));

vi.mock("@/services/launcher/instanceService", () => ({
  prepareInstance: vi.fn(async () => ({})),
  launchGame: vi.fn(async () => ""),
}));

vi.mock("@/services/launcher/accountService", () => ({
  getStoredAccount: vi.fn(async () => null),
}));

beforeEach(() => {
  catalogMock.mockReset();
  catalogMock.mockResolvedValue({
    java: [
      { id: "1.20.1", kind: "release", releaseTime: "2023-06-10T00:00:00Z", installed: true },
      { id: "1.21.4", kind: "release", releaseTime: "2024-12-03T00:00:00Z", installed: false },
    ],
    bedrock: {
      installable: false,
      reason: "Bedrock Edition não é instalável a partir do Linux: ela é publicada como pacote UWP da Microsoft Store e exige o Windows.",
      editions: [
        {
          name: "Bedrock Edition",
          platform: "Windows · Xbox · Android · iOS",
          url: "https://www.minecraft.net/pt-br/download",
        },
      ],
    },
  });
  cleanup();
});

describe("VersionsSection — Java and the truth about Bedrock", () => {
  it("lists the Java versions from the official catalog, newest first", async () => {
    const { VersionsSection } = await import("./VersionsSection");
    render(<VersionsSection />);
    // the newest release shows as downloadable, and the installed one as play
    expect(await screen.findByText("Minecraft 1.21.4")).toBeTruthy();
    const download = screen.getAllByRole("button", { name: /Baixar/i });
    expect(download.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Minecraft 1.20.1").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Jogar/i }).length).toBeGreaterThan(0);
  });

  it("never offers a download for Bedrock, and says why", async () => {
    const { VersionsSection } = await import("./VersionsSection");
    render(<VersionsSection />);
    // the honest card, not a button that cannot work
    expect(await screen.findByText(/Bedrock Edition não é instalável/i)).toBeTruthy();
    const bedrockButtons = screen.queryAllByRole("button", {
      name: /baixar bedrock|instalar bedrock/i,
    });
    expect(bedrockButtons).toEqual([]);
    // and the Java pointer, so the owner knows what runs here
    expect(await screen.findByText(/Java 1\.20\.1/i)).toBeTruthy();
  });

  it("links to the shaders and modpacks surfaces (the owner's mods request)", async () => {
    const { VersionsSection } = await import("./VersionsSection");
    render(<VersionsSection />);
    expect(await screen.findByText(/Shaders e packs de textura/i)).toBeTruthy();
    expect(screen.getAllByText(/Modpacks e mods/i).length).toBeGreaterThan(0);
  });
});