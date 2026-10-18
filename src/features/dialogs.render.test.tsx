/**
 * Render smoke — the owner's report: clicking Build/server actions showed
 * "only a scrollbar in the right corner and nothing happens". That is the
 * signature of a dialog whose CONTENT dies inside the overlay (a render
 * crash inside the Radix portal leaves an empty scrollable overlay).
 *
 * This suite renders every critical dialog for real (jsdom) — if any of
 * them throws, the test fails with the actual stack instead of the user
 * seeing a dead overlay.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach } from "vitest";

// every test unmounts its dialog — Radix keeps a body scroll-lock per open
// overlay; leaked overlays would poison the next test's DOM
afterEach(() => cleanup());
import { MemoryRouter } from "react-router-dom";

// ---- tauri surface mocks (the app code only runs inside tauri) ----
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    // plausible, honest answers per command — enough for a render pass
    switch (cmd) {
      case "list_project_files":
        return [];
      case "read_project_file":
        return "motd=A VOXEL server\n";
      case "servers_scan_disk":
        return [];
      case "modrinth_download":
      case "documents_extract":
      case "documents_write":
      case "server_import_world":
      case "server_import_structure":
      case "server_update_metadata":
      case "server_generate_dossier":
      case "project_delete":
      case "structure_generate":
        return {};
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
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/services/secrets/secretsService", () => ({
  secretsGet: vi.fn(async () => null),
  secretsSet: vi.fn(async () => ({})),
  secretsHas: vi.fn(async () => false),
  secretsDelete: vi.fn(async () => ({})),
  secretsClearAll: vi.fn(async () => ({})),
  secretsBackendInfo: vi.fn(async () => ({})),
  AI_API_KEY_ID: "ai_api_key",
}));
vi.mock("@/services/db/client", () => ({
  getDb: vi.fn(async () => ({
    select: vi.fn(async () => []),
    execute: vi.fn(async () => ({})),
  })),
}));
vi.mock("@/services/storage/storageService", () => ({
  getStorageBase: vi.fn(async () => "/tmp/voxel-home"),
  getAppPaths: vi.fn(async () => ({
    configDir: "/tmp/voxel-config",
    dataDir: "/tmp/voxel-data",
    databasePath: "/tmp/voxel.db",
  })),
  openInFileManager: vi.fn(async () => {}),
  openAuthUrl: vi.fn(async () => {}),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const fakeProject = {
  id: "p1",
  name: "Dark Kingdom",
  slug: "dark-kingdom",
  type: "mod" as const,
  minecraft_version: "1.20.1",
  loader: "fabric" as const,
  description: null,
  license: "MIT",
  path: "/tmp/voxel-home/projects/dark-kingdom",
  repository_url: null,
  status: "active",
  last_build_status: null,
  last_build_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const fakeServer = {
  id: "s1",
  name: "Kingdom SMP",
  slug: "kingdom-smp",
  software: "paper" as const,
  minecraft_version: "1.20.1",
  path: "/tmp/voxel-home/servers/kingdom-smp",
  port: 25565,
  ram_mb: 2048,
  status: "stopped",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function inRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("critical dialogs render (no dead overlays)", () => {
  it("CreateServerDialog opens with its wizard content", async () => {
    const { CreateServerDialog } = await import("@/features/servers/CreateServerDialog");
    inRouter(<CreateServerDialog open onOpenChange={() => {}} />);
    expect(screen.getAllByText("Create server").length).toBeGreaterThan(0);
    // the world-setup section the owner uses
    expect(screen.getByText("Terrain")).toBeTruthy();
  });

  it("ServerCustomizeDialog opens with its tabs and world fields", async () => {
    const { ServerCustomizeDialog } = await import("@/features/servers/ServerCustomizeDialog");
    inRouter(
      <ServerCustomizeDialog
        server={fakeServer}
        open
        onOpenChange={() => {}}
        basePath="/tmp/voxel-home"
      />,
    );
    expect(screen.getAllByText("Customize server").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI Studio").length).toBeGreaterThan(0);
    // the rename field lives on the World tab — click through for real
    fireEvent.click(screen.getByText("World"));
    expect(screen.getByText("Server name")).toBeTruthy();
  });

  it("DiagnosticsDialog opens and starts its real checks", async () => {
    const { DiagnosticsDialog } = await import("@/components/DiagnosticsDialog");
    render(
      <DiagnosticsDialog
        basePath="/tmp/voxel-home"
        openExternal
        onOpenChangeExternal={() => {}}
      />,
    );
    expect(screen.getAllByText("Diagnostics").length).toBeGreaterThan(0);
  });

  it("ModCommandsDialog opens with the designer", async () => {
    const { ModCommandsDialog } = await import("@/features/projects/workspace/ModCommandsDialog");
    inRouter(
      <ModCommandsDialog
        project={fakeProject}
        open
        onOpenChange={() => {}}
        basePath="/tmp/voxel-home"
        packFormat={15}
      />,
    );
    expect(screen.getAllByText("Custom commands for this mod").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Design a command").length).toBeGreaterThan(0);
  });

  it("DeleteProjectDialog opens with the typed-slug confirm", async () => {
    const { DeleteProjectDialog } = await import("@/features/projects/workspace/DeleteProjectDialog");
    inRouter(
      <DeleteProjectDialog
        project={fakeProject}
        onClose={() => {}}
        redirectTo="/projects"
      />,
    );
    // the dialog describes what it will delete — not an empty overlay
    // the overlay exists and is a real dialog (not a dead scroll-locked body)
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(screen.getByText(/This removes/i)).toBeTruthy();
  });
});
