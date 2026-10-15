/**
 * Marketplace (local) — your own assets, showcased and one click from play:
 * exported modpacks (facts from their manifests), authored shaderpacks (with
 * their sky swatches) and your mods (with live build status + Play).
 * Everything listed here is real and lives in this workspace.
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowDownToLine, FolderOpen, Package, Palette, Play, Sparkles } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import {
  importModpackInto,
  listModpacks,
  type SavedModpack,
} from "@/services/modpacks/modpackService";
import {
  installShaderPack,
  listShaderPacks,
  type ShaderPackInfo,
} from "@/services/shaders/shaderService";
import { getShaderStyle } from "@voxel/core/shaderStyleCatalog";
import { openInFileManager } from "@/services/storage/storageService";
import { LaunchDialog } from "@/features/projects/workspace/LaunchDialog";
import { cn } from "@/lib/utils";
import type { ProjectRecord } from "@/types";

interface LauncherInstance {
  slug: string;
  mods: string[];
  shaderPacks: string[];
  lastBuildJar: string | null;
}

function SkySwatch({ styleId }: { styleId: string }) {
  const style = getShaderStyle(styleId);
  const sky: number[] = style ? [...style.params.skyTop] : [10, 20, 64];
  const accent: number[] = style ? [...style.params.sunColor] : [126, 232, 250];
  const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const mix = (a: number[], b: number[]): number[] =>
    a.map((v, i) => Math.round(v * 0.75 + b[i] * 0.25));
  return (
    <div
      className="relative h-16 w-full overflow-hidden rounded-lg border border-border/70"
      style={{
        background: `linear-gradient(180deg, ${rgb(sky)} 0%, ${rgb(mix(sky, accent))} 100%)`,
      }}
    >
      <span
        className="absolute right-3 top-3 h-3.5 w-3.5 rounded-full"
        style={{
          background: rgb(accent),
          boxShadow: `0 0 14px ${rgb(accent)}`,
        }}
      />
    </div>
  );
}

function BuildDot({ status }: { status: string | null }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        status === "success"
          ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
          : status === "failed"
            ? "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.7)]"
            : "bg-muted-foreground/40",
      )}
      title={status ?? "never built"}
    />
  );
}

export function MarketplacePage() {
  const navigate = useNavigate();
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const projects = useProjectsStore((s) => s.projects);

  const [packs, setPacks] = useState<SavedModpack[]>([]);
  const [shaders, setShaders] = useState<ShaderPackInfo[]>([]);
  const [instances, setInstances] = useState<LauncherInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runProject, setRunProject] = useState<ProjectRecord | null>(null);

  const refresh = useCallback(async () => {
    if (!basePath) return;
    setLoading(true);
    try {
      const [p, s, inst] = await Promise.all([
        listModpacks(basePath),
        listShaderPacks(basePath),
        invoke<LauncherInstance[]>("launcher_overview", { basePath }),
      ]);
      setPacks(p);
      setShaders(s);
      setInstances(inst);
    } catch (error) {
      toast.error("Could not load the marketplace", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const installPack = async (pack: SavedModpack, slug: string | null) => {
    if (!basePath || !slug) return;
    setBusyId(pack.fileName);
    try {
      const result = await importModpackInto(basePath, pack.fullPath, slug);
      toast.success(`"${result.modpackName}" installed`, {
        description: `${result.modCount} jar(s) → instances/${slug}/mods`,
        duration: 8000,
      });
    } catch (error) {
      toast.error("Install failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyId(null);
    }
  };

  const installShader = async (pack: ShaderPackInfo, slug: string | null) => {
    if (!basePath || !slug) return;
    setBusyId(pack.slug);
    try {
      const result = await installShaderPack(basePath, slug, pack.slug);
      toast.success(`${pack.name} installed`, {
        description: result.installedPath,
        duration: 8000,
      });
    } catch (error) {
      toast.error("Install failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyId(null);
    }
  };

  const builtProjects = projects.filter((p) => p.last_build_status !== null);

  const instanceSelect = (value: string | null, onChange: (v: string) => void) => (
    <select
      className="h-8 rounded-md border border-border bg-card/60 px-2 text-xs outline-none focus:border-primary"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    >
      {instances.length === 0 && <option value="">prepare an instance first</option>}
      {instances.map((i) => (
        <option key={i.slug} value={i.slug}>
          {i.slug}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-gradient">
            {t("Marketplace")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Your own assets, showcased: exported modpacks, authored shaderpacks
            and your mods — every card is real, lives in this workspace and is
            one click from play.
          </p>
        </div>
        <Badge variant="outline">local · {packs.length + shaders.length + projects.length} assets</Badge>
      </header>

      {/* ---------------- Modpacks ---------------- */}
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">{t("Modpacks")}</h2>
          <span className="text-[11px] text-muted-foreground">
            facts read from each zip's manifest
          </span>
        </div>
        {packs.length === 0 ? (
          <EmptyState
            icon="spark"
            title="No modpacks exported yet"
            hint="The Modpacks tab exports what you build into shareable zips — they show up here."
            action={
              <Button variant="outline" size="sm" onClick={() => navigate("/modpacks")}>
                Go to Modpacks
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {packs.map((pack) => (
              <Card key={pack.fileName} className="animate-card-rise border-border/70 bg-card/60">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{pack.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        v{pack.version} · {new Date(pack.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="secondary">{pack.loader}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">MC {pack.mcVersion}</Badge>
                    <Badge variant="outline">{pack.modCount} mods</Badge>
                    <Badge variant="outline">{pack.shaderPackCount} shaders</Badge>
                    <Badge variant="outline">{(pack.sizeBytes / 1048576).toFixed(1)} MB</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {instanceSelect(instances[0]?.slug ?? null, () => {})}
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void openInFileManager(pack.fullPath)}
                        title="Reveal"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyId === pack.fileName || instances.length === 0}
                        onClick={() => void installPack(pack, instances[0]?.slug ?? null)}
                      >
                        <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
                        Install
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- Shaderpacks ---------------- */}
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">{t("Shaderpacks")}</h2>
          <span className="text-[11px] text-muted-foreground">
            the sky swatch is the pack's real style palette
          </span>
        </div>
        {shaders.length === 0 ? (
          <EmptyState
            icon="cube"
            title="No shaderpacks authored yet"
            hint="The Shaders tab creates Iris-compatible packs from 32 style presets — they show up here."
            action={
              <Button variant="outline" size="sm" onClick={() => navigate("/shaders")}>
                Go to Shaders
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {shaders.map((pack) => (
              <Card key={pack.slug} className="animate-card-rise border-border/70 bg-card/60">
                <CardContent className="space-y-3">
                  <SkySwatch styleId={pack.styleId} />
                  <div>
                    <p className="truncate text-sm font-semibold">{pack.name}</p>
                    <p className="text-[10px] capitalize text-muted-foreground">{pack.styleId} style</p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {instanceSelect(instances[0]?.slug ?? null, () => {})}
                    <Button
                      size="sm"
                      disabled={busyId === pack.slug || instances.length === 0}
                      onClick={() => void installShader(pack, instances[0]?.slug ?? null)}
                    >
                      <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
                      Install
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- Your mods ---------------- */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">{t("Your mods")}</h2>
          <span className="text-[11px] text-muted-foreground">
            live build status · Play launches the real instance
          </span>
        </div>
        {builtProjects.length === 0 ? (
          <EmptyState
            icon="spark"
            title="No built mods yet"
            hint="Build a project and it shows up here with its live status and a Play button."
            action={
              <Button variant="outline" size="sm" onClick={() => navigate("/projects")}>
                Go to Projects
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {builtProjects.map((project) => (
              <Card key={project.id} className="animate-card-rise border-border/70 bg-card/60">
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold">
                      <BuildDot status={project.last_build_status} />
                      {project.name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {project.loader} · MC {project.minecraft_version} ·{" "}
                      {project.last_build_status === "success" ? "jar ready" : "last build failed"}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setRunProject(project)} title="Play">
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    {t("Play")}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {loading && <p className="mt-6 text-center text-xs text-muted-foreground">loading your assets…</p>}

      <LaunchDialog
        project={runProject ?? projects[0]}
        open={runProject !== null}
        onOpenChange={(open) => {
          if (!open) setRunProject(null);
        }}
      />
    </div>
  );
}
