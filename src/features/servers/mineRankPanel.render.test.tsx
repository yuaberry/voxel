/**
 * Render smoke — the Mine Rank panel is a NEW surface inside the server
 * console. The owner's report pattern ("only a scrollbar and nothing
 * happens") happens when a panel dies inside the Radix overlay, so this
 * suite renders the panel for real (jsdom) and proves its sections exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => cleanup());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    switch (cmd) {
      case "read_project_file":
        // the datapack marker is absent in this smoke test
        throw new Error("not found");
      case "server_import_world":
        return "world imported";
      default:
        return [];
    }
  }),
  convertFileSrc: vi.fn(() => ""),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
  save: vi.fn(async () => null),
  confirm: vi.fn(async () => false),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const fakeServer = {
  id: "s1",
  name: "Rankup SMP",
  slug: "rankup-smp",
  software: "vanilla" as const,
  minecraft_version: "1.20.1",
  path: "/tmp/voxel-home/servers/rankup-smp",
  port: 25565,
  ram_mb: 2048,
  status: "running",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("MineRankPanel renders (no dead panel)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the module header, the tiers, the coins and the map section", async () => {
    const { MineRankPanel } = await import("./MineRankPanel");
    render(
      <MineRankPanel server={fakeServer} basePath="/tmp/voxel-home" running={false} />,
    );

    expect(screen.getAllByText("Mine Rank").length).toBeGreaterThan(0);
    expect(screen.getByText("Tiers")).toBeTruthy();
    expect(screen.getByText("Moedas")).toBeTruthy();
    expect(screen.getByText("Mapa do mundo")).toBeTruthy();
    // the install button is the primary action of the panel
    expect(screen.getByRole("button", { name: /Instalar/i })).toBeTruthy();
    // the world map import asks for the attribution BEFORE the file picker
    expect(screen.getByPlaceholderText(/Nome do mapa/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Licença/i)).toBeTruthy();
  });

  it("lists every command of the manifest in the families", async () => {
    const { MineRankPanel } = await import("./MineRankPanel");
    const { MINE_RANK_COMMANDS, MINE_RANK_FAMILY_LABELS } = await import(
      "@/services/servers/mineRankServer"
    );
    render(
      <MineRankPanel server={fakeServer} basePath="/tmp/voxel-home" running={false} />,
    );

    // the first family is open by default — its commands are on screen
    const firstFamily = MINE_RANK_COMMANDS[0].family;
    expect(screen.getByText(MINE_RANK_FAMILY_LABELS[firstFamily])).toBeTruthy();
    expect(screen.getByText(/Comandos/)).toBeTruthy();
  });
});
