/**
 * Launcher — play directly from the app (briefing §31 made visible):
 * every prepared instance with its installed mods and shader packs,
 * the latest compiled jar of each project, and the Run you already trust.
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FolderOpen, Package, Palette, Rocket, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { openInFileManager } from "@/services/storage/storageService";
import { invoke } from "@tauri-apps/api/core";
import { LaunchDialog } from "@/features/projects/workspace/LaunchDialog";
import { EmptyArt } from "@/components/EmptyState";
import { formatRelativeTime } from "@/lib/utils";
import type { ProjectRecord } from "@/types";

interface LauncherInstance {
  slug: string;
  mods: string[];
  shaderPacks: string[];
  lastBuildJar: string | null;
}

export function LauncherPage() {
  const navigate = useNavigate();
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const projects = useProjectsStore((s) => s.projects);

  const [instances, setInstances] = useState<LauncherInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [runProject, setRunProject] = useState<ProjectRecord | null>(null);

  const refresh = useCallback(async () => {
    if (!basePath) return;
    setLoading(true);
    try {
      const list = await invoke<LauncherInstance[]>("launcher_overview", { basePath });
      setInstances(list);
    } catch (error) {
      toast.error("Could not load instances", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    // microtask: refresh sets loading synchronously before its first await
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const projectFor = (slug: string) => projects.find((p) => p.slug === slug) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="flex items-center justify-between pb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-gradient">{t("Launcher")}</h1>
          <p className="text-sm text-muted-foreground">
            Play directly from VOXEL — your prepared instances, the mods and
            shaders installed in each one, and the jar each project built last.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />
          Refresh
        </Button>
      </div>

      {instances.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border/80 px-6 py-16 text-center">
          <div className="drop-shadow-[0_0_18px_rgba(145,85,255,0.25)]">
            <EmptyArt.CubeArt />
          </div>
          <div>
            <p className="font-semibold">No instances yet</p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Open a project and press <b>Run</b> once — VOXEL prepares an
              isolated instance with the official Minecraft runtime, your
              compiled mod in <span className="font-mono">mods/</span>, and
              it appears here to play anytime.
            </p>
          </div>
          <Button variant="gradient" onClick={() => navigate("/projects")}>
            <Rocket className="h-4 w-4" />
            Go to projects
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {instances.map((instance) => {
            const project = projectFor(instance.slug);
            return (
              <Card key={instance.slug} className="group animate-card-rise">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">
                        {project?.name ?? instance.slug}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        instances/{instance.slug}
                      </p>
                    </div>
                    <span
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                      title="prepared"
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {project && (
                      <>
                        <Badge variant="default">{project.loader ?? "mod"}</Badge>
                        <Badge variant="secondary">MC {project.minecraft_version}</Badge>
                      </>
                    )}
                    {instance.lastBuildJar ? (
                      <Badge variant="success">✓ {instance.lastBuildJar}</Badge>
                    ) : (
                      <Badge variant="outline">never built</Badge>
                    )}
                  </div>

                  <div className="mt-3 space-y-2 text-[11px] text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                      {instance.mods.length > 0 ? (
                        <span className="font-mono leading-relaxed">
                          mods: {instance.mods.join(", ")}
                        </span>
                      ) : (
                        <span>no mods installed yet</span>
                      )}
                    </div>
                    <div className="flex items-start gap-2">
                      <Palette className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                      {instance.shaderPacks.length > 0 ? (
                        <span className="font-mono leading-relaxed">
                          shaders: {instance.shaderPacks.join(", ")}
                        </span>
                      ) : (
                        <span>no shader packs</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <Button
                      variant="gradient"
                      size="sm"
                      disabled={!project}
                      onClick={() => project && setRunProject(project)}
                      title={project ? "Play this instance" : "Project not found in the workspace"}
                    >
                      <Rocket className="h-3.5 w-3.5" />
                      Play
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void openInFileManager(
                          `${basePath}/instances/${instance.slug}`,
                        ).catch((e) =>
                          toast.error("Could not open folder", { description: String(e) }),
                        )
                      }
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Reveal
                    </Button>
                    {project && (
                      <span className="ml-auto text-[10px] text-muted-foreground/70">
                        {formatRelativeTime(project.updated_at)}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {runProject && (
        <LaunchDialog
          project={runProject}
          open={runProject !== null}
          onOpenChange={(open) => !open && setRunProject(null)}
        />
      )}
    </div>
  );
}
