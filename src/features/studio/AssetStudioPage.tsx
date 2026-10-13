/**
 * Asset Studio (roadmap §9.6) — REAL pixel-art item textures, generated in
 * the Rust perimeter with the same proven recipes as the template sprites.
 * Live preview (base64, nothing written) → one click writes into the
 * project's assets tree. The AI agent can call the same generator.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Brush, Eye, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import {
  generateItemTexture,
  STYLES_BY_KIND,
  type AssetKind,
  type ItemStyle,
} from "@/services/assets/assetStudioService";
import { cn } from "@/lib/utils";

const PRESET_PALETTES: { name: string; primary: string; secondary: string }[] = [
  { name: "Darksteel", primary: "#5a6a94", secondary: "#7ee8fa" },
  { name: "Voxel", primary: "#9155ff", secondary: "#7ee8fa" },
  { name: "Ember", primary: "#e25822", secondary: "#ffcc4d" },
  { name: "Verdant", primary: "#3fa34d", secondary: "#a3e635" },
  { name: "Royal", primary: "#c9a227", secondary: "#5a3d2b" },
  { name: "Abyss", primary: "#1f3b73", secondary: "#9bb7d4" },
];

export function AssetStudioPage() {
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const projects = useProjectsStore((s) => s.projects);

  const [slug, setSlug] = useState<string | null>(null);
  const [itemId, setItemId] = useState("darksteel_ingot");
  const [assetKind, setAssetKind] = useState<AssetKind>("item");
  const [style, setStyle] = useState<ItemStyle>("sword");
  const [primary, setPrimary] = useState("#5a6a94");
  const [secondary, setSecondary] = useState("#7ee8fa");
  const [preview, setPreview] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [wrotePath, setWrotePath] = useState<string | null>(null);

  const stylesForKind = STYLES_BY_KIND[assetKind];
  const activeStyle = stylesForKind.includes(style) ? style : (stylesForKind[0] as ItemStyle);

  const project = useMemo(
    () => projects.find((p) => p.slug === slug) ?? null,
    [projects, slug],
  );

  useEffect(() => {
    if (!slug && projects.length > 0) setSlug(projects[0].slug);
  }, [projects, slug]);

  const renderPreview = useCallback(async () => {
    if (!basePath || !project || !itemId.trim()) {
      setPreview(null);
      return;
    }
    try {
      const result = await generateItemTexture({
        storageBase: basePath,
        projectRel: `projects/${project.slug}`,
        modId: project.slug.replace(/-/g, "_"),
        itemId: itemId.trim(),
        style: activeStyle,
        primary,
        secondary,
        assetKind,
        previewOnly: true,
      });
      setPreview(result.pngBase64);
    } catch (error) {
      setPreview(null);
      toast.error("Preview failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [basePath, project, itemId, activeStyle, assetKind, primary, secondary]);

  useEffect(() => {
    const t = setTimeout(() => void renderPreview(), 180);
    return () => clearTimeout(t);
  }, [renderPreview]);

  const handleWrite = async () => {
    if (!basePath || !project || !itemId.trim()) return;
    setWriting(true);
    try {
      const result = await generateItemTexture({
        storageBase: basePath,
        projectRel: `projects/${project.slug}`,
        modId: project.slug.replace(/-/g, "_"),
        itemId: itemId.trim(),
        style: activeStyle,
        primary,
        secondary,
        assetKind,
        previewOnly: false,
      });
      setWrotePath(result.wrotePath);
      toast.success("Texture written", {
        description: result.wrotePath ?? undefined,
        duration: 8000,
      });
    } catch (error) {
      toast.error("Write failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setWriting(false);
    }
  };

  const invalidId = itemId.trim().length > 0 && !/^[a-z][a-z0-9_]*$/.test(itemId.trim());

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Asset Studio</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Real 16x16 pixel-art item textures — same proven recipes as the
            template sprites, any palette. The AI agent can call this generator
            too, so new items never ship with missing art.
          </p>
        </div>
        <Badge variant="outline">16x16 · {assetKind === "item" ? "item sprite" : "block face"}</Badge>
      </header>

      {projects.length === 0 ? (
        <Card className="border-border/70 bg-card/60">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No projects yet — create one first and its assets tree becomes the
            destination.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Preview */}
          <Card className="animate-card-rise border-border/70 bg-card/60 lg:col-span-2">
            <CardContent className="flex flex-col items-center justify-center gap-5 py-8">
              <div className="rounded-2xl border border-border/70 bg-[#0b0e18] p-8">
                {preview ? (
                  <img
                    src={`data:image/png;base64,${preview}`}
                    alt="Texture preview"
                    className="h-40 w-40"
                    style={{ imageRendering: "pixelated" }}
                  />
                ) : (
                  <div className="flex h-40 w-40 items-center justify-center text-muted-foreground">
                    <Eye className="h-8 w-8 opacity-40" />
                  </div>
                )}
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                Live preview — nothing is written until you save.
              </p>
            </CardContent>
          </Card>

          {/* Controls */}
          <Card className="animate-card-rise border-border/70 bg-card/60 [animation-delay:80ms] lg:col-span-3">
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Project</Label>
                  <select
                    className="h-9 w-full rounded-md border border-border bg-card/60 px-2 text-sm outline-none focus:border-primary"
                    value={project?.slug ?? ""}
                    onChange={(e) => setSlug(e.target.value)}
                  >
                    {projects.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Item id</Label>
                  <Input
                    className={cn(invalidId && "border-destructive")}
                    placeholder="darksteel_ingot"
                    value={itemId}
                    onChange={(e) => setItemId(e.target.value)}
                  />
                  {invalidId && (
                    <p className="text-[11px] text-destructive">
                      snake_case, starts with a letter
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Asset type
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["item", "block"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setAssetKind(k)}
                        className={cn(
                          "rounded-lg border px-2 py-1.5 text-xs font-medium capitalize transition-all active:scale-[0.96]",
                          assetKind === k
                            ? "border-primary/70 bg-primary/15 text-primary shadow-[0_0_10px_rgba(145,85,255,0.2)]"
                            : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                        )}
                      >
                        {k === "item" ? "Item" : "Block face"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Style
                  </Label>
                  <div className="grid grid-cols-4 gap-2">
                    {stylesForKind.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStyle(s as ItemStyle)}
                        className={cn(
                          "rounded-lg border px-2 py-1.5 text-xs font-medium capitalize transition-all active:scale-[0.96]",
                          activeStyle === s
                            ? "border-primary/70 bg-primary/15 text-primary shadow-[0_0_10px_rgba(145,85,255,0.2)]"
                            : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Primary color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primary}
                      onChange={(e) => setPrimary(e.target.value)}
                      className="h-9 w-12 cursor-pointer rounded-md border border-border bg-card/60"
                    />
                    <Input value={primary} onChange={(e) => setPrimary(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Secondary color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={secondary}
                      onChange={(e) => setSecondary(e.target.value)}
                      className="h-9 w-12 cursor-pointer rounded-md border border-border bg-card/60"
                    />
                    <Input value={secondary} onChange={(e) => setSecondary(e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Palettes
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_PALETTES.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => {
                        setPrimary(p.primary);
                        setSecondary(p.secondary);
                      }}
                      className="flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition-all hover:border-primary/40 active:scale-[0.96]"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: p.primary }}
                      />
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: p.secondary }}
                      />
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                className="w-full"
                disabled={!preview || writing || invalidId}
                onClick={() => void handleWrite()}
              >
                <Save className="mr-2 h-4 w-4" />
                {writing ? "Writing…" : "Write into project"}
              </Button>
              {wrotePath && (
                <p className="flex items-center gap-1.5 text-center text-[10px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  <span className="truncate">{wrotePath}</span>
                </p>
              )}
              <p className="text-center text-[10px] text-muted-foreground">
                <Brush className="mr-1 inline h-3 w-3" />
                {"Lands in "}
                <code className="text-foreground/70">
                  {assetKind === "item"
                    ? "src/main/resources/assets/<mod_id>/textures/item/"
                    : "src/main/resources/assets/<mod_id>/textures/block/"}
                </code>
                {" — add the model + lang entry (or let the agent do it end-to-end)."}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
