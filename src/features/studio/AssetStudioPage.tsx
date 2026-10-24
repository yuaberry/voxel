/**
 * Asset Studio (roadmap §9.6) — REAL assets, all three kinds:
 *  item sprites and block faces (pixel-art recipes, live preview, one-click
 *  write) and procedural .nbt STRUCTURES (four templates, deterministic in
 *  the seed, isometric preview of the exact block list, structure-block
 *  ready). The AI agent can call the same generators.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "@/i18n";
import { toast } from "sonner";
import { Brush, Dice5, Eye, Globe2, Package, Save, Sparkles } from "lucide-react";
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
import {
  generateStructure,
  STRUCTURE_KINDS,
  type StructureGenResult,
  type StructureKindId,
} from "@/services/assets/structureService";
import { IsoStructureCanvas } from "@/features/studio/IsoStructureCanvas";
import {
  createDimension,
  dimensionSchemaSupported,
  WORLD_PRESETS,
  type WorldPresetId,
} from "@/services/assets/worldgenService";
import { cn } from "@/lib/utils";

const PRESET_PALETTES: { name: string; primary: string; secondary: string }[] = [
  { name: "Darksteel", primary: "#5a6a94", secondary: "#7ee8fa" },
  { name: "Voxel", primary: "#9155ff", secondary: "#7ee8fa" },
  { name: "Ember", primary: "#e25822", secondary: "#ffcc4d" },
  { name: "Verdant", primary: "#3fa34d", secondary: "#a3e635" },
  { name: "Royal", primary: "#c9a227", secondary: "#5a3d2b" },
  { name: "Abyss", primary: "#1f3b73", secondary: "#9bb7d4" },
];

type StudioTab = AssetKind | "structure" | "world";

const TABS: { id: StudioTab; label: string }[] = [
  { id: "item", label: "Item" },
  { id: "block", label: "Block face" },
  { id: "structure", label: "Structure" },
  { id: "world", label: "World" },
];

export function AssetStudioPage() {
  const navigate = useNavigate();
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const projects = useProjectsStore((s) => s.projects);

  const [slug, setSlug] = useState<string | null>(null);
  const [itemId, setItemId] = useState("darksteel_ingot");
  const [tab, setTab] = useState<StudioTab>("item");
  const [style, setStyle] = useState<ItemStyle>("sword");
  const [frames, setFrames] = useState(1);
  const [primary, setPrimary] = useState("#5a6a94");
  const [secondary, setSecondary] = useState("#7ee8fa");
  const [preview, setPreview] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [wrotePath, setWrotePath] = useState<string | null>(null);

  // structure state
  const [structureKind, setStructureKind] = useState<StructureKindId>("watchtower");
  const [structureSeed, setStructureSeed] = useState<number>(() =>
    Math.floor(Math.random() * 999999),
  );
  const [structureResult, setStructureResult] = useState<StructureGenResult | null>(null);
  const [structureBusy, setStructureBusy] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState("");

  // world state
  const [worldPreset, setWorldPreset] = useState<WorldPresetId>("eternal_realm");
  const [worldBusy, setWorldBusy] = useState(false);
  const [worldResult, setWorldResult] = useState<{
    traits: string[];
    typePath: string;
  } | null>(null);

  const stylesForTab =
    tab === "structure" || tab === "world" ? [] : STYLES_BY_KIND[tab as AssetKind];
  const activeStyle = stylesForTab.includes(style)
    ? style
    : (stylesForTab[0] as ItemStyle);

  const project = useMemo(
    () => projects.find((p) => p.slug === slug) ?? null,
    [projects, slug],
  );

  // React's "adjust state during render": first project becomes the selection
  if (!slug && projects.length > 0) {
    setSlug(projects[0].slug);
  }

  // the id field follows the tab (item id vs structure id) — React's
  // "adjust state during render", applied only on real tab transitions:
  // typing an id by hand is never overwritten
  const [lastTab, setLastTab] = useState(tab);
  if (lastTab !== tab) {
    setLastTab(tab);
    if (tab === "structure" && itemId === "darksteel_ingot") setItemId("watch_post");
    else if (tab !== "structure" && itemId === "watch_post") setItemId("darksteel_ingot");
    else if (tab === "world" && itemId === "darksteel_ingot") setItemId("dark_realm");
    else if (tab !== "world" && itemId === "dark_realm") setItemId("darksteel_ingot");
  }

  const invalidId = itemId.trim().length > 0 && !/^[a-z][a-z0-9_]*$/.test(itemId.trim());

  // ---------------- item/block preview (no manual memo: the compiler owns it) ----------------
  useEffect(() => {
    if (tab === "structure" || tab === "world") return;
    if (!basePath || !project || !itemId.trim()) {
      void Promise.resolve().then(() => setPreview(null));
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const result = await generateItemTexture({
          storageBase: basePath,
          projectRel: `projects/${project.slug}`,
          modId: project.slug.replace(/-/g, "_"),
          itemId: itemId.trim(),
          style: activeStyle,
          primary,
          secondary,
          assetKind: tab as AssetKind,
          frames,
          previewOnly: true,
        });
        if (!cancelled) setPreview(result.pngBase64);
      } catch (error) {
        if (!cancelled) {
          setPreview(null);
          toast.error("Preview failed", {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tab, basePath, project, itemId, activeStyle, primary, secondary, frames]);

  // ---------------- structure preview ----------------
  useEffect(() => {
    if (tab !== "structure" || !basePath || !project || !itemId.trim()) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const result = await generateStructure({
          storageBase: basePath,
          projectRel: `projects/${project.slug}`,
          structureId: itemId.trim(),
          kind: structureKind,
          seed: structureSeed,
          mcVersion: project.minecraft_version,
          previewOnly: true,
        });
        if (!cancelled) setStructureResult(result);
      } catch (error) {
        if (!cancelled) {
          toast.error("Structure preview failed", {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tab, basePath, project, itemId, structureKind, structureSeed]);

  // ---------------- writes ----------------
  const handleWriteTexture = async () => {
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
        assetKind: tab as AssetKind,
        frames,
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

  const handleWriteWorld = async () => {
    if (!basePath || !project || !itemId.trim()) return;
    setWorldBusy(true);
    try {
      const result = await createDimension({
        storageBase: basePath,
        projectRel: `projects/${project.slug}`,
        dimensionId: itemId.trim(),
        preset: worldPreset,
        mcVersion: project.minecraft_version,
      });
      setWorldResult({
        traits: result.traits,
        typePath: result.dimensionTypePath,
      });
      toast.success("Dimension created", {
        description: result.dimensionTypePath,
        duration: 9000,
      });
    } catch (error) {
      toast.error("Dimension failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setWorldBusy(false);
    }
  };

  const handleWriteStructure = async () => {
    if (!basePath || !project || !itemId.trim()) return;
    setStructureBusy(true);
    try {
      const result = await generateStructure({
        storageBase: basePath,
        projectRel: `projects/${project.slug}`,
        structureId: itemId.trim(),
        kind: structureKind,
        seed: structureSeed,
        mcVersion: project.minecraft_version,
        previewOnly: false,
      });
      setStructureResult(result);
      toast.success("Structure written", {
        description: `${result.blockCount} blocks · ${result.wrotePath ?? ""}`,
        duration: 9000,
      });
    } catch (error) {
      toast.error("Write failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setStructureBusy(false);
    }
  };

  const isStructure = tab === "structure";

  // Hand the request to the AI Creator (project pre-selected, prompt pre-filled —
  // the user reviews and sends; nothing runs without them seeing it)
  const askAgent = async () => {
    if (!project || !agentPrompt.trim()) return;
    const { useUiStore } = await import("@/stores/uiStore");
    useUiStore.getState().setAiHandoff({
      projectId: project.id,
      prompt: agentPrompt.trim(),
    });
    navigate("/ai-creator");
  };
  const isWorld = tab === "world";

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-gradient">
            {t("Asset Studio")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Real assets, generated in the security perimeter: pixel-art item and
            block textures, procedural <code>.nbt</code> structures a structure
            block loads, and custom dimensions written straight into the mod's
            datapack — every preview shows exactly what gets saved.
          </p>
        </div>
        <Badge variant="outline">
          {isStructure
            ? "structure · .nbt"
            : tab === "world"
              ? "dimension · datapack"
              : frames > 1
                ? `16x16 · animated (${frames} frames + .mcmeta)`
                : "16x16 · vanilla-style"}
        </Badge>
      </header>

      <Card className="mb-6 border-primary/25 bg-primary/5">
        <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Want a change, improvement or something new?</p>
            <p className="text-[11px] text-muted-foreground">
              Describe it and the AI agent edits THIS project for real — textures,
              blocks, structures, dimensions and code, with the same audit trail.
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Input
              placeholder="e.g. add a ruby sword with red glow"
              value={agentPrompt}
              onChange={(e) => setAgentPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void askAgent();
              }}
            />
            <Button
              size="sm"
              variant="gradient"
              className="shrink-0"
              disabled={!project || !agentPrompt.trim()}
              onClick={() => void askAgent()}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Ask the agent
            </Button>
          </div>
        </CardContent>
      </Card>

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
            <CardContent className="flex h-full flex-col items-center justify-center gap-5 py-8">
              <div
                className={cn(
                  "relative overflow-hidden rounded-2xl border border-border/70 bg-[#0b0e18]",
                  isStructure ? "h-64 w-full" : "p-8",
                )}
              >
                {isWorld ? (
                  worldResult ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                      <Globe2 className="h-10 w-10 text-primary drop-shadow-[0_0_14px_rgba(145,85,255,0.5)]" />
                      {worldResult.traits.map((t) => (
                        <p key={t} className="text-[11px] text-muted-foreground">
                          · {t} ·
                        </p>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <Globe2 className="h-8 w-8 opacity-40" />
                    </div>
                  )
                ) : isStructure ? (
                  structureResult ? (
                    <IsoStructureCanvas
                      blocks={structureResult.blocks}
                      size={structureResult.size}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <Package className="h-8 w-8 opacity-40" />
                    </div>
                  )
                ) : preview ? (
                  frames > 1 ? (
                    <div
                      className="voxel-anim-preview h-40 w-40"
                      style={{
                        backgroundImage: `url(data:image/png;base64,${preview})`,
                        animationDuration: `${frames * 0.25}s`,
                      }}
                    />
                  ) : (
                    <img
                      src={`data:image/png;base64,${preview}`}
                      alt="Texture preview"
                      className="h-40 w-40"
                      style={{ imageRendering: "pixelated" }}
                    />
                  )
                ) : (
                  <div className="flex h-40 w-40 items-center justify-center text-muted-foreground">
                    <Eye className="h-8 w-8 opacity-40" />
                  </div>
                )}
                {isStructure && structureResult && (
                  <span className="absolute bottom-2 right-2 rounded-full bg-background/80 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {structureResult.size.join("×")} · {structureResult.blockCount} blocks
                  </span>
                )}
                {isWorld && worldResult && (
                  <span className="absolute bottom-2 right-2 rounded-full bg-background/80 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {itemId} · {project?.minecraft_version}
                  </span>
                )}
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                {isStructure
                  ? "Isometric preview of the exact block list — the .nbt contains these and only these."
                  : isWorld
                    ? "The realm's physics and generator — era-factual for 1.20.1 through 1.21.8."
                    : "Live preview — nothing is written until you save."}
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
                  <Label>{isStructure ? "Structure id" : isWorld ? "Dimension id" : "Item id"}</Label>
                  <Input
                    className={cn(invalidId && "border-destructive")}
                    placeholder={isStructure ? "watch_post" : isWorld ? "dark_realm" : "darksteel_ingot"}
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

              {/* Asset type */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("Asset type")}
                </Label>
                <div className="grid grid-cols-4 gap-2">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={cn(
                        "rounded-lg border px-2 py-1.5 text-xs font-medium transition-all active:scale-[0.96]",
                        tab === t.id
                          ? "border-primary/70 bg-primary/15 text-primary shadow-[0_0_10px_rgba(145,85,255,0.2)]"
                          : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {isWorld ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Realm preset
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {WORLD_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setWorldPreset(preset)}
                          className={cn(
                            "rounded-lg border px-2 py-1.5 text-xs font-medium transition-all active:scale-[0.96]",
                            worldPreset === preset
                              ? "border-primary/70 bg-primary/15 text-primary shadow-[0_0_10px_rgba(145,85,255,0.2)]"
                              : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                          )}
                        >
                          {preset.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                  </div>
                  {dimensionSchemaSupported(project?.minecraft_version ?? "") ? (
                    <>
                      <Button
                        className="w-full"
                        disabled={!itemId.trim() || invalidId || worldBusy}
                        onClick={() => void handleWriteWorld()}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {worldBusy ? "Writing…" : "Write dimension into project"}
                      </Button>
                      <p className="text-center text-[10px] text-muted-foreground">
                        Two era-factual JSONs land in the mod datapack
                        (dimension_type + dimension). Build the jar and travel
                        in-game — <code>/execute in {project?.slug.replace(/-/g, "_")}:{itemId} run tp @s ~ ~ ~</code>.
                      </p>
                    </>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border/70 p-3 text-[11px] text-muted-foreground">
                      The 26.x rework is not covered by this generator yet —
                      honest no. Your project is on MC{" "}
                      {project?.minecraft_version ?? "?"}.
                    </p>
                  )}
                </>
              ) : isStructure ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Structure kind
                    </Label>
                    <div className="grid grid-cols-4 gap-2">
                      {STRUCTURE_KINDS.map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setStructureKind(k)}
                          className={cn(
                            "rounded-lg border px-2 py-1.5 text-xs font-medium capitalize transition-all active:scale-[0.96]",
                            structureKind === k
                              ? "border-primary/70 bg-primary/15 text-primary shadow-[0_0_10px_rgba(145,85,255,0.2)]"
                              : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                          )}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div className="space-y-1.5">
                      <Label>Seed</Label>
                      <Input
                        type="number"
                        value={structureSeed}
                        onChange={(e) =>
                          setStructureSeed(Math.max(0, Number(e.target.value) || 0))
                        }
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Deterministic — same seed, same build. Minecraft version{" "}
                        {project?.minecraft_version ?? "?"} decides DataVersion and
                        the datapack folder (structures/ vs structure/).
                      </p>
                    </div>
                    <div className="flex items-end">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          setStructureSeed(Math.floor(Math.random() * 999999))
                        }
                        title="Roll a new seed"
                      >
                        <Dice5 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <Button
                    className="w-full"
                    disabled={!itemId.trim() || invalidId || structureBusy}
                    onClick={() => void handleWriteStructure()}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {structureBusy ? "Writing…" : "Write .nbt into project"}
                  </Button>
                  <p className="text-center text-[10px] text-muted-foreground">
                    <Sparkles className="mr-1 inline h-3 w-3 text-primary" />
                    Real gzip'd NBT (size/blocks/palette/DataVersion) — load it
                    in-game with a structure block, or reference it from a
                    datapack.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFrames(1)}
                      className={
                        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all active:scale-[0.96] " +
                        (frames === 1
                          ? "border-primary/70 bg-primary/15 text-primary shadow-[0_0_10px_rgba(145,85,255,0.2)]"
                          : "border-border/70 text-muted-foreground hover:border-primary/40")
                      }
                    >
                      Static
                    </button>
                    <button
                      type="button"
                      onClick={() => setFrames(4)}
                      className={
                        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all active:scale-[0.96] " +
                        (frames > 1
                          ? "border-primary/70 bg-primary/15 text-primary shadow-[0_0_10px_rgba(145,85,255,0.2)]"
                          : "border-border/70 text-muted-foreground hover:border-primary/40")
                      }
                    >
                      ✨ Animated (4 frames)
                    </button>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Style
                    </Label>
                    <div className="grid grid-cols-4 gap-2">
                      {stylesForTab.map((s) => (
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
                    onClick={() => void handleWriteTexture()}
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
                    Lands in{" "}
                    <code className="text-foreground/70">
                      {tab === "item"
                        ? "src/main/resources/assets/<mod_id>/textures/item/"
                        : "src/main/resources/assets/<mod_id>/textures/block/"}
                    </code>{" "}
                    — add the model + lang entry (or let the agent do it
                    end-to-end).
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
