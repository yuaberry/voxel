/**
 * The automatic Minecraft download — the owner's requirement: "coloque o
 * minecraft para download automatico no voxel quando o usuario configurar a
 * conta Microsoft ou Ely.By".
 *
 * These tests pin the two rules that matter:
 * 1. A runtime that is already complete is NEVER downloaded again.
 * 2. A broken version is reported, never thrown — one bad project cannot
 *    stop the others (nor the sign-in that triggered the download).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord } from "@/types";

const runtimeStatus = vi.fn();
const prepareInstance = vi.fn();
// mirrors the real rule: a vanilla runtime has no loader version
const resolveLoaderVersion = vi.fn(
  async (project: { loader?: string | null }) =>
    project.loader === "vanilla" ? "" : "0.16.9",
);

vi.mock("./instanceService", () => ({
  runtimeStatus: (basePath: string, mcVersion: string, loader: string, slug?: string) =>
    runtimeStatus(basePath, mcVersion, loader, slug),
  prepareInstance: (
    basePath: string,
    slug: string,
    mcVersion: string,
    loader: string,
    loaderVersion: string,
    onProgress?: unknown,
  ) => prepareInstance(basePath, slug, mcVersion, loader, loaderVersion, onProgress),
  resolveLoaderVersion: (project: { loader?: string | null }) =>
    resolveLoaderVersion(project),
  runtimeLoaderFor: (project: { loader?: string | null }) => {
    const loader = (project.loader ?? "").toLowerCase();
    if (loader === "vanilla" || loader === "paper") return "vanilla";
    return "fabric";
  },
}));

import {
  downloadProjectRuntimes,
  planRuntimeDownloads,
} from "./runtimeService";

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "p1",
    name: "Mine Rank",
    slug: "mine-rank",
    type: "datapack",
    minecraft_version: "1.20.1",
    loader: "vanilla",
    description: null,
    license: "MIT",
    path: "/workspace/projects/mine-rank",
    repository_url: null,
    status: "active",
    last_build_status: null,
    last_build_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("runtimeService — the automatic download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeStatus.mockResolvedValue({
      ready: true,
      mcVersion: "1.20.1",
      loader: "vanilla",
      missing: [],
    });
    prepareInstance.mockResolvedValue({
      instanceDir: "/workspace/instances/mine-rank",
      downloaded: 12,
      skipped: 3600,
    });
  });

  it("does not download a runtime that is already complete", async () => {
    const plan = await planRuntimeDownloads("/workspace", [project()]);
    expect(plan.pending).toHaveLength(0);
    expect(plan.ready).toHaveLength(1);

    const result = await downloadProjectRuntimes("/workspace", [project()]);
    expect(prepareInstance).not.toHaveBeenCalled();
    expect(result.prepared).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it("downloads what is missing, with the loader the project declares", async () => {
    runtimeStatus.mockResolvedValue({
      ready: false,
      mcVersion: "1.20.1",
      loader: "vanilla",
      missing: ["client.jar"],
    });

    const result = await downloadProjectRuntimes("/workspace", [project()]);

    expect(prepareInstance).toHaveBeenCalledTimes(1);
    expect(prepareInstance).toHaveBeenCalledWith(
      "/workspace",
      "mine-rank",
      "1.20.1",
      "vanilla",
      "",
      undefined,
    );
    expect(result.prepared).toHaveLength(1);
    expect(result.downloadedFiles).toBe(12);
    expect(result.skippedFiles).toBe(3600);
  });

  it("a mod project asks for the fabric runtime", async () => {
    runtimeStatus.mockResolvedValue({
      ready: false,
      mcVersion: "1.20.1",
      loader: "fabric",
      missing: ["client.jar"],
    });

    await downloadProjectRuntimes("/workspace", [
      project({ type: "mod", loader: "fabric", slug: "dark-kingdom" }),
    ]);

    expect(prepareInstance).toHaveBeenCalledWith(
      "/workspace",
      "dark-kingdom",
      "1.20.1",
      "fabric",
      "0.16.9",
      undefined,
    );
  });

  it("reports a failed download instead of throwing it", async () => {
    runtimeStatus.mockResolvedValue({
      ready: false,
      mcVersion: "9.9.9",
      loader: "vanilla",
      missing: ["version metadata (9.9.9)"],
    });
    prepareInstance.mockRejectedValue(
      new Error("Minecraft 9.9.9 not found in the official manifest"),
    );

    const result = await downloadProjectRuntimes("/workspace", [project()]);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("official manifest");
    expect(result.prepared).toHaveLength(0);
  });

  it("one broken project does not stop the others", async () => {
    runtimeStatus.mockResolvedValue({
      ready: false,
      mcVersion: "1.20.1",
      loader: "vanilla",
      missing: ["client.jar"],
    });
    prepareInstance
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        instanceDir: "/workspace/instances/second",
        downloaded: 1,
        skipped: 0,
      });

    const result = await downloadProjectRuntimes("/workspace", [
      project({ slug: "broken", name: "Broken" }),
      project({ slug: "working", name: "Working" }),
    ]);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].project.slug).toBe("broken");
    expect(result.prepared).toHaveLength(1);
    expect(result.prepared[0].slug).toBe("working");
  });

  it("does nothing when there is no workspace", async () => {
    const result = await downloadProjectRuntimes("", [project()]);
    expect(prepareInstance).not.toHaveBeenCalled();
    expect(result.prepared).toHaveLength(0);
  });
});
