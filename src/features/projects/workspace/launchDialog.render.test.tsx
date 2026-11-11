/**
 * Render smoke — the Run dialog.
 *
 * The owner's report: pressing Play on the Mine Rank project showed
 * "No compiled mod jar found — run Build first so the game loads your
 * changes" and the game never started.
 *
 * Two facts are pinned here:
 * 1. The warning is GONE — a datapack project has no jar, and that is not
 *    an error.
 * 2. The dialog talks about the RUNTIME (what the launch really needs),
 *    not about the existence of the instance folder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

afterEach(() => cleanup());

const runtimeStatus = vi.fn();
const copyModJar = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  convertFileSrc: vi.fn(() => ""),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/services/launcher/instanceService", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/launcher/instanceService")
  >("@/services/launcher/instanceService");
  return {
    ...actual,
    runtimeStatus: (...args: unknown[]) => runtimeStatus(...args),
    copyModJar: (...args: unknown[]) => copyModJar(...args),
    prepareInstance: vi.fn(async () => ({
      instanceDir: "/workspace/instances/mine-rank",
      downloaded: 1,
      skipped: 0,
    })),
    launchGame: vi.fn(async () => "launch/mine-rank"),
    stopGame: vi.fn(async () => {}),
    registerInstance: vi.fn(async () => {}),
  };
});
vi.mock("@/services/launcher/accountService", () => ({
  getStoredAccount: vi.fn(async () => ({
    provider: "microsoft",
    username: "Yua",
    uuid: "uuid",
    accessToken: "token",
  })),
  getLaunchAccount: vi.fn(async () => ({
    provider: "microsoft",
    username: "Yua",
    uuid: "uuid",
    accessToken: "token",
  })),
}));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({
      settings: {
        storage: { basePath: "/workspace" },
        launcher: { ramMb: 4096, elyClientId: "voxel" },
        java: { customJavaPath: "" },
      },
    }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const vanillaProject = {
  id: "p1",
  name: "Mine Rank",
  slug: "mine-rank",
  type: "datapack" as const,
  minecraft_version: "1.20.1",
  loader: "vanilla" as const,
  description: null,
  license: "MIT",
  path: "/workspace/projects/mine-rank",
  repository_url: null,
  status: "active",
  last_build_status: null,
  last_build_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const modProject = { ...vanillaProject, type: "mod" as const, loader: "fabric" as const };

async function renderDialog(project: typeof vanillaProject | typeof modProject) {
  const { LaunchDialog } = await import("./LaunchDialog");
  return render(
    <MemoryRouter>
      <LaunchDialog project={project} open onOpenChange={() => {}} />
    </MemoryRouter>,
  );
}

describe("LaunchDialog — no dead end for the owner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeStatus.mockResolvedValue({
      ready: true,
      mcVersion: "1.20.1",
      loader: "vanilla",
      missing: [],
    });
    copyModJar.mockResolvedValue(null);
  });

  it("never shows the 'No compiled mod jar found' warning", async () => {
    await renderDialog(vanillaProject);
    await waitFor(() => expect(screen.getByText("Minecraft runtime")).toBeTruthy());
    expect(screen.queryByText(/No compiled mod jar found/i)).toBeNull();
  });

  it("says a datapack project needs no mod jar", async () => {
    await renderDialog(vanillaProject);
    await waitFor(() =>
      expect(screen.getByText(/datapack — no mod jar needed/i)).toBeTruthy(),
    );
    // the jar is not copied for a vanilla project at all
    expect(copyModJar).not.toHaveBeenCalled();
  });

  it("shows the runtime state, not the existence of a folder", async () => {
    runtimeStatus.mockResolvedValue({
      ready: false,
      mcVersion: "1.20.1",
      loader: "vanilla",
      missing: ["client.jar"],
    });
    await renderDialog(vanillaProject);
    await waitFor(() =>
      expect(screen.getByText(/missing: client\.jar/i)).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /Download Minecraft/i })).toBeTruthy();
  });

  it("a mod project without a jar is a hint, never a blocker", async () => {
    await renderDialog(modProject);
    await waitFor(() =>
      expect(screen.getByText(/not built yet — the client still starts/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/No compiled mod jar found/i)).toBeNull();
  });
});
