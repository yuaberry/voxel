/**
 * Shader Studio — 32 iconic looks as VOXEL style presets.
 *
 * Presets tune our own generated composite pass (Iris/OptiFire-compatible)
 * to evoke famous community shaderpacks. Every card previews live via
 * WebGL with the exact grading the generated pack applies. Attribution is
 * honest: each style links to a public search for the original — nothing
 * from third-party packs is copied or redistributed here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  FolderOpen,
  Loader2,
  Palette,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatRelativeTime, cn } from "@/lib/utils";
import {
  SHADER_CATEGORIES,
  SHADER_STYLES,
  getShaderStyle,
  type ShaderStyleCategory,
} from "@/services/shaders/shaderStyleCatalog";
import { slugifyPackName } from "@/services/shaders/shaderPackGenerator";
import {
  createShaderPack,
  deleteShaderPack,
  installShaderPack,
  listShaderInstances,
  listShaderPacks,
  type ShaderPackInfo,
} from "@/services/shaders/shaderService";
import { openInFileManager } from "@/services/storage/storageService";
import { ShaderPreviewCanvas } from "./ShaderPreviewCanvas";
import { ShaderPackEditor } from "./ShaderPackEditor";

type CategoryFilter = "all" | ShaderStyleCategory;

function rgbCss(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

export function ShadersPage() {
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);

  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedId, setSelectedId] = useState("bsl");
  const [packName, setPackName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [packs, setPacks] = useState<ShaderPackInfo[]>([]);
  const [packsLoaded, setPacksLoaded] = useState(false);
  const [instances, setInstances] = useState<string[]>([]);
  const [instanceChoice, setInstanceChoice] = useState<Record<string, string>>({});
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);

  const [editorPack, setEditorPack] = useState<ShaderPackInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShaderPackInfo | null>(null);

  const style = useMemo(
    () => getShaderStyle(selectedId) ?? SHADER_STYLES[0],
    [selectedId],
  );

  const visibleStyles = useMemo(
    () =>
      category === "all"
        ? SHADER_STYLES
        : SHADER_STYLES.filter((s) => s.category === category),
    [category],
  );

  // Default pack name follows the selected style unless the user typed one
  const effectivePackName = packName ?? `VOXEL ${style.name}`;

  const refresh = useCallback(async () => {
    try {
      const [packList, instanceList] = await Promise.all([
        listShaderPacks(basePath),
        listShaderInstances(basePath).catch(() => [] as string[]),
      ]);
      setPacks(packList);
      setInstances(instanceList);
      setPacksLoaded(true);
    } catch (error) {
      toast.error("Could not load shaderpacks", { description: String(error) });
    }
  }, [basePath]);

  useEffect(() => {
    if (basePath) void refresh();
  }, [basePath, refresh]);

  const handleCreate = useCallback(async () => {
    if (!effectivePackName.trim() || creating) return;
    setCreating(true);
    try {
      const info = await createShaderPack({ basePath, style, name: effectivePackName.trim() });
      toast.success("Shaderpack created", {
        description: `${info.name} → shaderpacks/${info.slug} — install it on an instance below.`,
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("already exists")) {
        toast.error("A shaderpack with this name already exists", {
          description: "Pick a different name (the folder name must be unique).",
        });
      } else {
        toast.error("Could not create shaderpack", { description: message });
      }
    } finally {
      setCreating(false);
    }
  }, [basePath, style, effectivePackName, creating, refresh]);

  const handleInstall = useCallback(
    async (pack: ShaderPackInfo) => {
      const instance = instanceChoice[pack.slug] ?? instances[0];
      if (!instance) {
        toast.error("No instance available", {
          description: "Prepare an instance first — open a project and press Run.",
        });
        return;
      }
      setInstallingSlug(pack.slug);
      try {
        const result = await installShaderPack(basePath, instance, pack.slug);
        toast.success("Installed", {
          description: `${pack.name} → ${result.installedPath}. Enable it in Iris / OptiFine in-game.`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("already installed")) {
          toast.info("Already installed on this instance");
        } else {
          toast.error("Could not install shaderpack", { description: message });
        }
      } finally {
        setInstallingSlug(null);
      }
    },
    [basePath, instances, instanceChoice],
  );

  const handleDelete = useCallback(
    async (pack: ShaderPackInfo) => {
      try {
        await deleteShaderPack(basePath, pack.slug);
        toast.success("Shaderpack deleted", { description: pack.name });
        setDeleteTarget(null);
        await refresh();
      } catch (error) {
        toast.error("Could not delete shaderpack", { description: String(error) });
      }
    },
    [basePath, refresh],
  );

  const copySourceUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(style.sourceUrl);
      toast.success("Search link copied", {
        description: "Open it in your browser to find the original shaderpack.",
      });
    } catch {
      toast.error("Could not copy the link");
    }
  }, [style.sourceUrl]);

  const slugPreview = useMemo(() => {
    try {
      return slugifyPackName(effectivePackName);
    } catch {
      return null;
    }
  }, [effectivePackName]);

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      {/* Header */}
      <div className="pb-8">
        <h1 className="text-2xl font-bold tracking-tight">Shader Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          32 iconic looks as style presets — every pack is 100% original
          VOXEL GLSL (Iris / OptiFire compatible), previewed live before
          you create it.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/60">
          Style presets evoke famous community shaderpacks for inspiration.
          Nothing is copied or redistributed — each card links to a public
          search for the original by its author.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Styles grid */}
        <div>
          <div className="flex flex-wrap gap-1.5 pb-4">
            {(["all", ...SHADER_CATEGORIES] as CategoryFilter[]).map((cat) => (
              <button
                key={cat}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium capitalize transition-colors",
                  category === cat
                    ? "bg-primary/15 text-primary"
                    : "bg-secondary/60 text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {visibleStyles.map((s, index) => {
              const selected = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  style={{ animationDelay: `${Math.min(index * 24, 320)}ms` }}
                  className={cn(
                    "animate-card-rise overflow-hidden rounded-xl border text-left transition-all hover:-translate-y-1 hover:shadow-[0_14px_36px_rgba(116,47,255,0.16)]",
                    selected
                      ? "border-primary/60 shadow-[0_0_0_1px_rgba(139,92,246,0.35)]"
                      : "border-border/70 hover:border-primary/40",
                  )}
                  onClick={() => setSelectedId(s.id)}
                >
                  {/* Style swatch: sky gradient + sun */}
                  <div
                    className="relative h-14 w-full"
                    style={{
                      background: `linear-gradient(to bottom, ${rgbCss(s.params.skyTop)}, ${rgbCss(s.params.skyHorizon)})`,
                    }}
                  >
                    <span
                      className="absolute right-6 top-1.5 h-3.5 w-3.5 rounded-full"
                      style={{
                        background: rgbCss(s.params.sunColor),
                        boxShadow: `0 0 14px 3px ${rgbCss(s.params.sunColor)}`,
                      }}
                    />
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{s.name}</p>
                      <Badge variant="secondary" className="capitalize">
                        {s.category}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {s.tagline}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Preview + create panel */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardContent className="p-4">
              <div className="overflow-hidden rounded-lg border border-border/70">
                <ShaderPreviewCanvas
                  params={style.params}
                  className="aspect-video w-full bg-[#0d1017]"
                />
              </div>

              <div className="pt-4">
                <p className="text-sm font-semibold">{style.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {style.tagline}
                </p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="secondary">Exposure {style.params.exposure.toFixed(2)}</Badge>
                  <Badge variant="secondary">Bloom {style.params.bloomStrength.toFixed(2)}</Badge>
                  <Badge variant="secondary">God rays {style.params.godRays.toFixed(2)}</Badge>
                  <Badge variant="secondary">Fog {style.params.fogDensity.toFixed(2)}</Badge>
                  <Badge variant="secondary">Vignette {style.params.vignette.toFixed(2)}</Badge>
                  <Badge variant="secondary">{style.params.tonemap}</Badge>
                </div>

                <div className="pt-4">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Shaderpack name
                  </label>
                  <div className="flex items-center gap-2 pt-1.5">
                    <Input
                      value={effectivePackName}
                      onChange={(e) => setPackName(e.target.value)}
                      placeholder="My custom look"
                      className="h-9"
                    />
                    <Button
                      onClick={() => void handleCreate()}
                      disabled={!effectivePackName.trim() || !slugPreview || creating}
                      size="sm"
                      variant="gradient"
                      className="h-9 shrink-0"
                    >
                      {creating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      Create
                    </Button>
                  </div>
                  {slugPreview && (
                    <p className="pt-1.5 font-mono text-[10px] text-muted-foreground/70">
                      shaderpacks/{slugPreview}/
                    </p>
                  )}
                </div>

                <div className="mt-4 rounded-lg border border-dashed border-border/80 p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <Sparkles className="h-3 w-3" />
                    Want the iconic original?
                  </p>
                  <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground/70">
                    {style.name} is a community shaderpack by its own author.
                    This preset only evokes its look with original code.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-secondary/60 px-2 py-1 text-[10px]">
                      {style.sourceUrl}
                    </code>
                    <Button size="sm" variant="secondary" className="h-7" onClick={() => void copySourceUrl()}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Your shaderpacks */}
      <div className="pt-12">
        <h2 className="text-lg font-bold tracking-tight">Your shaderpacks</h2>
        <p className="text-xs text-muted-foreground">
          Generated packs live in <span className="font-mono">shaderpacks/</span> —
          edit the GLSL, install on an instance, or reveal the folder.
        </p>

        {packsLoaded && packs.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/80 px-6 py-10 text-center">
            <div className="rounded-xl bg-secondary/60 p-4">
              <Palette className="h-7 w-7 text-muted-foreground/70" />
            </div>
            <p className="text-sm font-semibold">No shaderpacks yet</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              Pick a style preset above, hit Create, then install it on a
              prepared instance. The generated composite pass runs in
              Iris / OptiFire out of the box.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {packs.map((pack) => {
              const styleInfo = getShaderStyle(pack.styleId);
              const instance = instanceChoice[pack.slug] ?? instances[0];
              return (
                <Card key={pack.slug} className="overflow-hidden">
                  <div
                    className="relative h-8 w-full"
                    style={{
                      background: styleInfo
                        ? `linear-gradient(to right, ${rgbCss(styleInfo.params.skyTop)}, ${rgbCss(styleInfo.params.skyHorizon)})`
                        : undefined,
                    }}
                  />
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{pack.name}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {pack.slug} · {formatRelativeTime(pack.createdAt)}
                        </p>
                      </div>
                      {styleInfo && (
                        <Badge variant="secondary" className="capitalize">
                          {styleInfo.category}
                        </Badge>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      {instances.length > 0 ? (
                        <>
                          <Select
                            value={instance}
                            onValueChange={(v) =>
                              setInstanceChoice((prev) => ({ ...prev, [pack.slug]: v }))
                            }
                          >
                            <SelectTrigger className="h-8 flex-1 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {instances.map((slug) => (
                                <SelectItem key={slug} value={slug}>
                                  {slug}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="h-8"
                            disabled={installingSlug === pack.slug}
                            onClick={() => void handleInstall(pack)}
                          >
                            {installingSlug === pack.slug ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            Install
                          </Button>
                        </>
                      ) : (
                        <p className="text-[10px] leading-relaxed text-muted-foreground/70">
                          No prepared instances — open a project and press Run
                          first.
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7"
                        onClick={() => setEditorPack(pack)}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit files
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7"
                        onClick={() =>
                          void openInFileManager(pack.path).catch((e) =>
                            toast.error("Could not open folder", { description: String(e) }),
                          )
                        }
                      >
                        <FolderOpen className="h-3 w-3" />
                        Reveal
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="ml-auto h-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(pack)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <ShaderPackEditor
        key={editorPack?.slug ?? "none"}
        pack={editorPack}
        basePath={basePath}
        onClose={() => setEditorPack(null)}
      />

      {/* Delete confirmation */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete shaderpack?</DialogTitle>
            <DialogDescription>
              “{deleteTarget?.name}” will be removed from{" "}
              <span className="font-mono">shaderpacks/{deleteTarget?.slug}</span>.
              Instances that already installed it keep their copy.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && void handleDelete(deleteTarget)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
