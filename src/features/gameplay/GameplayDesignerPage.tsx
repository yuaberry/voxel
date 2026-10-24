import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { toast } from "sonner";
import { Check, Loader2, Plus, RefreshCw, Utensils, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useProjectsStore } from "@/stores/projectsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  buildShapedRecipe,
  buildShapelessRecipe,
  createItem,
  scanProject,
  writeRecipe,
  type ItemDef,
  type ScanResult,
} from "@/services/gameplay/gameplayDesigner";
import { cn } from "@/lib/utils";

/**
 * VOXEL Gameplay Designer — the editor that works on the REAL mod files:
 * it scans the registered items (any of the three loader styles we ship),
 * shows the implementation status of each (model/lang/texture/recipe —
 * the consistency check), and creates items by writing every matching
 * file coherently. Recipes are real datapack JSON.
 */
export function GameplayDesignerPage() {
  const projects = useProjectsStore((s) => s.projects);
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const [projectId, setProjectId] = useState<string>("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [recipeFor, setRecipeFor] = useState<ItemDef | null>(null);

  // spec for the new-item form
  const [specId, setSpecId] = useState("");
  const [specName, setSpecName] = useState("");
  const [specPrimary, setSpecPrimary] = useState("#9155ff");
  const [specSecondary, setSpecSecondary] = useState("#3580f7");

  // recipe designer state
  const [recipeMode, setRecipeMode] = useState<"shaped" | "shapeless">("shaped");
  const [recipeCount, setRecipeCount] = useState("1");
  const [grid, setGrid] = useState<string[]>(["", "", "", "", "", "", "", "", ""]);
  const [keyItems, setKeyItems] = useState<Record<string, string>>({
    A: "minecraft:iron_ingot",
    B: "minecraft:diamond",
  });
  const [shapelessItems, setShapelessItems] = useState("minecraft:iron_ingot, minecraft:diamond");

  const project = projects.find((p) => p.id === projectId) ?? null;

  const refresh = useCallback(async () => {
    if (!basePath || !project) return;
    try {
      setScan(await scanProject(basePath, project));
    } catch (error) {
      toast.error("Could not scan this project", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [basePath, project]);

  // React's "adjust state during render": first project becomes the selection
  // the moment projects arrive — no effect, no synchronous write
  if (!projectId && projects.length > 0) {
    setProjectId(projects[0].id);
  }

  useEffect(() => {
    // microtask: refresh sets busy synchronously before its first await
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const handleCreate = async () => {
    if (!project || !basePath || busy) return;
    setBusy(true);
    try {
      const result = await createItem(basePath, project, {
        id: specId.trim(),
        displayName: specName.trim(),
        primary: specPrimary,
        secondary: specSecondary,
      });
      toast.success(`Item "${specName.trim()}" created`, {
        description: `${result.filesWritten.length} real files written (java, model, lang, texture). Build to see it in game.`,
        duration: 12000,
      });
      setNewItemOpen(false);
      setSpecId("");
      setSpecName("");
      await refresh();
    } catch (error) {
      toast.error("Could not create the item", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleWriteRecipe = async () => {
    if (!project || !basePath || !recipeFor || busy) return;
    setBusy(true);
    try {
      const resultId = `${scan?.modId ?? project.slug.replace(/-/g, "_")}:${recipeFor.id}`;
      let json: string;
      if (recipeMode === "shaped") {
        const rows: [string, string, string] = ["", "", ""];
        for (let r = 0; r < 3; r++) {
          rows[r] = grid
            .slice(r * 3, r * 3 + 3)
            .map((cell) => (cell.trim() ? cell.trim().toUpperCase() : " "))
            .join("")
            .padEnd(3, " ")
            .slice(0, 3);
        }
        const keys: Record<string, string> = {};
        for (let i = 0; i < grid.length; i++) {
          const cell = grid[i]?.trim().toUpperCase();
          if (cell && keys[cell] === undefined && keyItems[cell]) {
            keys[cell] = keyItems[cell];
          }
        }
        json = buildShapedRecipe(resultId, Number(recipeCount) || 1, {
          rows,
          keys,
        });
      } else {
        const items = shapelessItems
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        json = buildShapelessRecipe(resultId, Number(recipeCount) || 1, items);
      }
      const rel = await writeRecipe(basePath, project, recipeFor.id, json);
      toast.success("Recipe written", {
        description: `${rel} — it is real datapack JSON; build and craft it in game.`,
        duration: 10000,
      });
      setRecipeFor(null);
      await refresh();
    } catch (error) {
      toast.error("Could not write the recipe", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="bg-gradient-to-r from-brand-purple to-brand-cyan bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
            {t("Gameplay Designer")}
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t(
              "The real registry of this mod — every item with its implementation status. Create items here and the java, model, lang and texture are all written coherently; design recipes as real datapack JSON.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 0 ? (
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder={t("Project")} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.loader} {p.minecraft_version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline">{t("Create a project first")}</Badge>
          )}
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={!project}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("Rescan")}
          </Button>
          <Button size="sm" variant="gradient" onClick={() => setNewItemOpen(true)} disabled={!project || !scan}>
            <Plus className="h-3.5 w-3.5" />
            {t("New item")}
          </Button>
        </div>
      </div>

      {scan && (
        <p className="mt-4 text-[11px] text-muted-foreground">
          {t("Detected style")}: <code className="font-mono text-primary">{scan.style}</code>
          {scan.modItemsRel ? (
            <> · {scan.items.length} {t("registered items")}</>
          ) : (
            <> · ModItems.java {t("not found — the layout is not supported yet")}</>
          )}
        </p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {scan?.items.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-primary/40"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-semibold text-primary">{item.id}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {item.displayName ?? "(no lang entry)"}
                </p>
              </div>
              {item.constName && (
                <Badge variant="outline" className="shrink-0 text-[9px]">{item.constName}</Badge>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <StatusPill ok={item.registered} label="java" />
              <StatusPill ok={item.model} label="model" />
              <StatusPill ok={item.lang} label="lang" />
              <StatusPill ok={item.texture} label="texture" />
              <StatusPill ok={item.recipe} label="recipe" />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={() => {
                setRecipeFor(item);
                setRecipeMode("shaped");
                setGrid(["", "", "", "", "", "", "", "", ""]);
              }}
            >
              <Utensils className="h-3.5 w-3.5" />
              {item.recipe ? t("Edit recipe") : t("Create recipe")}
            </Button>
          </div>
        ))}
        {scan && scan.items.length === 0 && scan.modItemsRel && (
          <p className="col-span-full rounded-xl border border-dashed border-border/70 px-6 py-12 text-center text-xs text-muted-foreground">
            {t("No registered items found in ModItems.java — create the first one.")}
          </p>
        )}
      </div>

      {/* New item dialog */}
      <Dialog open={newItemOpen} onOpenChange={setNewItemOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("New item")}</DialogTitle>
            <DialogDescription>
              {t(
                "Everything is written for real: ModItems.java (detected style), the model, the lang entry (merged, never overwritten) and a generated texture.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("Item id (registry name)")}</Label>
              <Input
                className="font-mono text-xs"
                placeholder="void_gem"
                value={specId}
                onChange={(e) => setSpecId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Display name (lang)")}</Label>
              <Input
                placeholder="Void Gem"
                value={specName}
                onChange={(e) => setSpecName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("Primary color")}</Label>
                <Input type="color" className="h-9" value={specPrimary} onChange={(e) => setSpecPrimary(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Secondary color")}</Label>
                <Input type="color" className="h-9" value={specSecondary} onChange={(e) => setSpecSecondary(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={() => setNewItemOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button size="sm" variant="gradient" onClick={() => void handleCreate()} disabled={busy || !specId.trim() || !specName.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("Create item")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recipe designer dialog */}
      <Dialog open={recipeFor !== null} onOpenChange={(next) => !next && setRecipeFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("Recipe")} — <code className="font-mono text-primary">{recipeFor?.id}</code>
            </DialogTitle>
            <DialogDescription>
              {t(
                "A real crafting recipe (datapack JSON). Shaped: put symbols in the grid and bind them to items. Shapeless: list the ingredients.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {(["shaped", "shapeless"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setRecipeMode(mode)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    recipeMode === mode
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground",
                  )}
                >
                  {mode === "shaped" ? t("Shaped (grid)") : t("Shapeless (list)")}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5">
                <Label className="text-[10px]">{t("Result")}</Label>
                <Input
                  className="h-8 w-16 text-xs"
                  type="number"
                  min={1}
                  max={64}
                  value={recipeCount}
                  onChange={(e) => setRecipeCount(e.target.value)}
                />
              </div>
            </div>

            {recipeMode === "shaped" ? (
              <>
                <div className="mx-auto grid w-40 grid-cols-3 gap-1.5">
                  {grid.map((cell, i) => (
                    <input
                      key={i}
                      value={cell}
                      maxLength={1}
                      onChange={(e) => {
                        const next = [...grid];
                        next[i] = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
                        setGrid(next);
                      }}
                      className="h-11 rounded-md border border-border bg-card text-center font-mono text-sm uppercase outline-none focus:border-primary"
                    />
                  ))}
                </div>
                <div className="space-y-1.5">
                  {Object.entries(keyItems).map(([symbol, item]) => (
                    <div key={symbol} className="flex items-center gap-2">
                      <span className="w-6 text-center font-mono text-sm font-semibold text-primary">{symbol}</span>
                      <span className="text-[10px] text-muted-foreground">→</span>
                      <Input
                        className="h-8 flex-1 font-mono text-xs"
                        value={item}
                        onChange={(e) =>
                          setKeyItems((prev) => ({ ...prev, [symbol]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setKeyItems((prev) => ({
                        ...prev,
                        [String.fromCharCode(65 + Object.keys(prev).length)]: "minecraft:stone",
                      }))
                    }
                  >
                    <Plus className="h-3 w-3" /> {t("Add symbol")}
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label>{t("Ingredients (comma-separated, with namespace)")}</Label>
                <Input
                  className="font-mono text-xs"
                  value={shapelessItems}
                  onChange={(e) => setShapelessItems(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={() => setRecipeFor(null)}>
              {t("Cancel")}
            </Button>
            <Button size="sm" variant="gradient" onClick={() => void handleWriteRecipe()} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("Write recipe")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium",
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-red-500/30 bg-red-500/10 text-red-400",
      )}
      title={ok ? `${label}: OK` : `${label}: MISSING`}
    >
      {ok ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}
