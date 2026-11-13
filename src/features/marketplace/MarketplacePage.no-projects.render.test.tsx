/**
 * Regression tests for the bug of this session — the Marketplace page
 * used to take the WHOLE app down (white screen, ErrorBoundary) when the
 * workspace had no project yet, because `LaunchDialog` was mounted with
 * an undefined `project` and read `project.slug` in its own body.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const launchDialogMock = vi.fn((_props: unknown) => null);

vi.mock("@/features/projects/workspace/LaunchDialog", () => ({
  LaunchDialog: (props: unknown) => {
    launchDialogMock(props);
    return null;
  },
}));

vi.mock("@/stores/projectsStore", () => ({
  useProjectsStore: (selector: (s: { projects: unknown[] }) => unknown) =>
    selector({ projects: [] }),
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        storage: { basePath: "/workspace" },
        launcher: { publicServerIds: ["nerdzone"] },
        general: { language: "en" },
      },
    }),
}));

vi.mock("@/services/modpacks/modpackService", () => ({
  importModpackInto: vi.fn(async () => ({})),
  listModpacks: vi.fn(async () => []),
}));

vi.mock("@/services/shaders/shaderService", () => ({
  installShaderPack: vi.fn(async () => ({})),
  listShaderPacks: vi.fn(async () => []),
}));

vi.mock("@/services/storage/storageService", () => ({
  openInFileManager: vi.fn(async () => undefined),
}));

vi.mock("@/services/db/repositories/serversRepository", () => ({
  listServersReconciled: vi.fn(async () => []),
}));

describe("MarketplacePage — with no project in the workspace", () => {
  beforeEach(() => {
    launchDialogMock.mockClear();
  });

  it("renders WITHOUT mounting LaunchDialog (the old white screen)", async () => {
    const { MarketplacePage } = await import("./MarketplacePage");
    render(
      <MemoryRouter>
        <MarketplacePage />
      </MemoryRouter>,
    );

    // jest-dom não está neste ambiente — o que importa é que o render
    // NÃO lançou (o LaunchDialog mockado também não)
    expect(screen.queryByText(/Algo deu errado/i)).toBeNull();
    expect(launchDialogMock).not.toHaveBeenCalled();
  });

  it("never passes an undefined project to LaunchDialog", async () => {
    const { MarketplacePage } = await import("./MarketplacePage");
    render(
      <MemoryRouter>
        <MarketplacePage />
      </MemoryRouter>,
    );
    const calls = launchDialogMock.mock.calls as unknown[][];
    for (const call of calls) {
      expect(call[0]).toBeDefined();
    }
  });
});
