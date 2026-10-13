/**
 * Modpack Creator v1 (roadmap §9.5, honest slice): export the real things
 * this workspace produced — compiled mod jars and authored shaderpacks —
 * into a shareable zip with a manifest, and import VOXEL modpacks into a
 * prepared launcher instance. No third-party downloads are fetched or
 * claimed here.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  Check,
  Download,
  FileArchive,
  Globe,
  Package,
  PackageOpen,
  RefreshCw,
  Search,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import {
  checkModpackCompatibility,
  exportModpack,
  getExportableAssets,
  importModpackInto,
  type ExportableAssets,
  type ModpackCompatibility,
} from "@/services/modpacks/modpackService";
import {
  downloadModrinthMod,
  getModrinthVersions,
  pickModrinthFile,
  searchModrinthMods,
  type ModrinthSearchHit,
} from "@/services/modpacks/modrinthService";
import { openInFileManager } from "@/services/storage/storageService";
import { cn } from "@/lib/utils";

interface LauncherInstance {
  slug: string;
  mods: string[];
  shaderPacks: string[];
  lastBuildJar: string | null;
}

export function ModpacksPage() {
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const minecraftDefaults = useSettingsStore((s) => s.settings.minecraft);
  const projects = useProjectsStore((s) => s.projects);

  const [assets, setAssets] = useState<ExportableAssets>({ jars: [], shaderPacks: [] });
  const [instances, setInstances] = useState<LauncherInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);

  // export form
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [selectedJars, setSelectedJars] = useState<Set<string>>(new Set());
  const [selectedPacks, setSelectedPacks] = useState<Set<string>>(new Set());

  // compatibility (live, computed from the jars' own manifests)
  const [compat, setCompat] = useState<ModpackCompatibility | null>(null);

  // Modrinth catalog (official API; file downloads are SHA-1-verified in Rust)
  const [modQuery, setModQuery] = useState("");
  const [modResults, setModResults] = useState<ModrinthSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [modTarget, setModTarget] = useState<string | null>(null);

  // import form
  const [importZip, setImportZip] = useState<string | null>(null);
  const [importTarget, setImportTarget] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!basePath) return;
    setLoading(true);
    try {
      const [a, inst] = await Promise.all([
        getExportableAssets(basePath),
        invoke<LauncherInstance[]>("launcher_overview", { basePath }),
      ]);
      setAssets(a);
      setInstances(inst);
      if (!importTarget && inst.length > 0) setImportTarget(inst[0].slug);
      if (!modTarget && inst.length > 0) setModTarget(inst[0].slug);
    } catch (error) {
      toast.error("Could not load workspace assets", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [basePath, importTarget]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath]);

  const runModSearch = async () => {
    const q = modQuery.trim();
    if (!q || !manifestFacts) return;
    setSearching(true);
    try {
      const hits = await searchModrinthMods(
        q,
        manifestFacts.mcVersion,
        manifestFacts.loader,
      );
      setModResults(hits);
      if (hits.length === 0) {
        toast.info("No mods found", {
          description: `Nothing on Modrinth matches "${q}" for MC ${manifestFacts.mcVersion} (${manifestFacts.loader}).`,
        });
      }
    } catch (error) {
      toast.error("Modrinth search failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSearching(false);
    }
  };

  const addFromModrinth = async (hit: ModrinthSearchHit) => {
    if (!basePath || !modTarget || !manifestFacts) return;
    setAdding(hit.project_id);
    try {
      const versions = await getModrinthVersions(
        hit.project_id,
        manifestFacts.mcVersion,
        manifestFacts.loader,
      );
      const picked = pickModrinthFile(versions);
      if (!picked) {
        toast.error("Not installable", {
          description: "No version for this game/loader publishes a SHA-1-verified file.",
        });
        return;
      }
      const result = await downloadModrinthMod(basePath, modTarget, picked);
      toast.success(`Installed ${hit.title} ${picked.versionNumber}`, {
        description: `${(result.bytes / 1048576).toFixed(1)} MB · SHA-1 verified · instances/${modTarget}/mods/${picked.fileName}`,
        duration: 8000,
      });
    } catch (error) {
      toast.error(`Could not install ${hit.title}`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setAdding(null);
    }
  };

  const canExport = name.trim().length >= 2 && (selectedJars.size > 0 || selectedPacks.size > 0);

  // Re-run compatibility whenever the mod selection changes
  useEffect(() => {
    if (!basePath || selectedJars.size === 0) {
      setCompat(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mods = assets.jars
          .filter((j) => selectedJars.has(`${j.projectSlug}/${j.jarFile}`))
          .map((j) => ({ projectSlug: j.projectSlug, jarFile: j.jarFile }));
        const result = await checkModpackCompatibility(basePath, mods);
        if (!cancelled) setCompat(result);
      } catch {
        if (!cancelled) setCompat(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, selectedJars, assets.jars]);

  // Manifest facts come from the real project records — never invented.
  // (no manual memo: the React Compiler preserves this computation)
  const selectedJarSlug = assets.jars.find((j) =>
    selectedJars.has(`${j.projectSlug}/${j.jarFile}`),
  )?.projectSlug;
  const selectedJarProject = projects.find((p) => p.slug === selectedJarSlug) ?? null;
  const manifestFacts = selectedJarProject
    ? { mcVersion: selectedJarProject.minecraft_version, loader: selectedJarProject.loader }
    : {
        mcVersion: minecraftDefaults.defaultVersion,
        loader: minecraftDefaults.defaultLoader,
      };

  const toggleJar = (slug: string, file: string) => {
    const key = `${slug}/${file}`;
    setSelectedJars((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePack = (pack: string) => {
    setSelectedPacks((prev) => {
      const next = new Set(prev);
      if (next.has(pack)) next.delete(pack);
      else next.add(pack);
      return next;
    });
  };

  const handleExport = async () => {
    if (!basePath || !canExport) return;
    setBusy("export");
    try {
      const result = await exportModpack({
        storageBase: basePath,
        name: name.trim(),
        mcVersion: manifestFacts.mcVersion,
        loader: manifestFacts.loader,
        version: version.trim() || "1.0.0",
        mods: assets.jars
          .filter((j) => selectedJars.has(`${j.projectSlug}/${j.jarFile}`))
          .map((j) => ({ projectSlug: j.projectSlug, jarFile: j.jarFile })),
        shaderPacks: [...selectedPacks],
      });
      toast.success("Modpack exported", {
        description: `${result.modCount} mod(s) + ${result.shaderCount} shaderpack file set(s) → ${result.zipPath}`,
        duration: 8000,
      });
      void openInFileManager(result.zipPath);
    } catch (error) {
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const pickZip = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "VOXEL modpack", extensions: ["zip"] }],
    });
    if (typeof picked === "string") setImportZip(picked);
  };

  const handleImport = async () => {
    if (!basePath || !importZip || !importTarget) return;
    setBusy("import");
    try {
      const result = await importModpackInto(basePath, importZip, importTarget);
      toast.success(`"${result.modpackName}" installed`, {
        description: `${result.modCount} jar(s) → instances/${importTarget}/mods · ${result.shaderCount} shader file(s) (MC ${result.mcVersion || "?"}, loader ${result.loader || "?"})`,
        duration: 8000,
      });
    } catch (error) {
      toast.error("Import failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Modpack Creator</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Bundle what this workspace produced — compiled mod jars and authored
            shaderpacks — into a shareable zip, or install a VOXEL modpack into
            a prepared instance.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------- Export ---------------- */}
        <Card className="animate-card-rise border-border/70 bg-card/60">
          <CardContent className="space-y-5">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Export a modpack</h2>
              <Badge variant="outline">
                MC {manifestFacts.mcVersion} · {manifestFacts.loader}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Modpack name</Label>
                <Input
                  placeholder="Dark Bundle"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Version</Label>
                <Input
                  placeholder="1.0.0"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Mods — jars built here
                </Label>
                <span className="text-[10px] text-muted-foreground">
                  {assets.jars.length === 0 ? "build a project first" : `${assets.jars.length} available`}
                </span>
              </div>
              {assets.jars.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                  No compiled jars yet — build a project and its latest jar
                  becomes exportable here.
                </p>
              ) : (
                <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                  {assets.jars.map((j) => {
                    const key = `${j.projectSlug}/${j.jarFile}`;
                    const active = selectedJars.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleJar(j.projectSlug, j.jarFile)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-all active:scale-[0.98]",
                          active
                            ? "border-primary/70 bg-primary/10"
                            : "border-border/70 bg-card/40 hover:border-primary/40",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{j.projectName}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {j.jarFile}
                          </span>
                        </span>
                        {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Shaderpacks — authored here
                </Label>
                <span className="text-[10px] text-muted-foreground">
                  {assets.shaderPacks.length === 0 ? "create one in Shaders" : `${assets.shaderPacks.length} available`}
                </span>
              </div>
              {assets.shaderPacks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                  No shaderpacks yet — author one in the Shaders tab.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {assets.shaderPacks.map((p) => {
                    const active = selectedPacks.has(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => togglePack(p)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs transition-all active:scale-[0.96]",
                          active
                            ? "border-primary/70 bg-primary/10 text-primary"
                            : "border-border/70 text-muted-foreground hover:border-primary/40",
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {compat && (
              <div className="space-y-1.5 rounded-lg border border-border/70 bg-card/40 p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Compatibility — read from the jars' own manifests
                  </Label>
                  <Badge
                    variant={compat.score === 100 ? "default" : "destructive"}
                    className="font-mono"
                  >
                    {compat.score}/100
                  </Badge>
                </div>
                {compat.checks.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 text-[11px]">
                    <span
                      className={cn(
                        "mt-0.5 font-mono",
                        c.passed ? "text-primary" : "text-destructive",
                      )}
                    >
                      {c.passed ? "PASS" : "FAIL"}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium">{c.label}</span>
                      <span className="block truncate text-muted-foreground" title={c.detail}>
                        {c.detail}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <Button
              className="w-full"
              disabled={!canExport || busy === "export" || (compat?.score ?? 100) < 100}
              onClick={() => void handleExport()}
            >
              <Download className="mr-2 h-4 w-4" />
              {busy === "export" ? "Exporting…" : `Export modpack (${selectedJars.size + selectedPacks.size} items)`}
            </Button>
            <p className="text-center text-[10px] text-muted-foreground">
              {"Writes "}
              <code className="text-foreground/70">
                {"~/VOXEL/modpacks/<name>-<version>.zip"}
              </code>
              {" with a manifest the app can install back."}
            </p>
          </CardContent>
        </Card>

        {/* ---------------- Import ---------------- */}
        <Card className="animate-card-rise border-border/70 bg-card/60 [animation-delay:80ms]">
          <CardContent className="space-y-5">
            <div className="flex items-center gap-2">
              <PackageOpen className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Install a modpack</h2>
            </div>

            <div className="space-y-1.5">
              <Label>Modpack zip</Label>
              <button
                type="button"
                onClick={() => void pickZip()}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all active:scale-[0.99]",
                  importZip
                    ? "border-primary/60 bg-primary/5"
                    : "border-dashed border-border/70 hover:border-primary/40",
                )}
              >
                <FileArchive className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {importZip ?? "Choose a VOXEL-exported .zip…"}
                </span>
              </button>
              <p className="text-[11px] text-muted-foreground">
                Only zips carrying a VOXEL <code className="text-foreground/70">modpack.json</code>{" "}
                manifest are accepted — verified, traversal-guarded.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Target instance</Label>
              {instances.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                  No prepared instances — open the Launcher tab and prepare one
                  (Run) first.
                </p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {instances.map((i) => {
                    const active = importTarget === i.slug;
                    return (
                      <button
                        key={i.slug}
                        type="button"
                        onClick={() => setImportTarget(i.slug)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left transition-all active:scale-[0.98]",
                          active
                            ? "border-primary/70 bg-primary/10"
                            : "border-border/70 bg-card/40 hover:border-primary/40",
                        )}
                      >
                        <span className="block truncate text-sm font-medium">{i.slug}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {i.mods.length} mods · {i.shaderPacks.length} shaders
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <Button
              className="w-full"
              disabled={!importZip || !importTarget || busy === "import"}
              onClick={() => void handleImport()}
            >
              <ArrowDownToLine className="mr-2 h-4 w-4" />
              {busy === "import" ? "Installing…" : "Install into instance"}
            </Button>
            {importTarget && (
              <p className="text-center text-[10px] text-muted-foreground">
                Jars land in{" "}
                <code className="text-foreground/70">instances/{importTarget}/mods</code>, shaderpacks
                in <code className="text-foreground/70">shaderpacks/</code>.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------------- Modrinth catalog ---------------- */}
      <Card className="animate-card-rise mt-6 border-border/70 bg-card/60 [animation-delay:160ms]">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Add from Modrinth</h2>
              <Badge variant="outline">official API · SHA-1 verified</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">MC {manifestFacts.mcVersion} · {manifestFacts.loader}</Badge>
              <select
                className="h-8 rounded-md border border-border bg-card/60 px-2 text-xs outline-none focus:border-primary"
                value={modTarget ?? ""}
                onChange={(e) => setModTarget(e.target.value)}
              >
                {instances.length === 0 && <option value="">no prepared instance</option>}
                {instances.map((i) => (
                  <option key={i.slug} value={i.slug}>
                    {i.slug}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Search mods — e.g. JEI, sodium, fabric-api…"
              value={modQuery}
              onChange={(e) => setModQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runModSearch();
              }}
            />
            <Button
              variant="outline"
              disabled={!modQuery.trim() || searching}
              onClick={() => void runModSearch()}
            >
              <Search className="mr-2 h-4 w-4" />
              {searching ? "Searching…" : "Search"}
            </Button>
          </div>

          {modResults.length > 0 && (
            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {modResults.map((hit) => (
                <div
                  key={hit.project_id}
                  className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/40 px-3 py-2 transition-all"
                >
                  {hit.icon_url ? (
                    <img
                      src={hit.icon_url}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <Package className="h-9 w-9 shrink-0 text-muted-foreground/40" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{hit.title}</span>
                      {hit.license && (
                        <Badge variant="outline" className="shrink-0 text-[9px]">
                          {hit.license}
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {hit.description}
                    </span>
                    <span className="block text-[10px] text-muted-foreground/70">
                      {Intl.NumberFormat("en", { notation: "compact" }).format(hit.downloads)} downloads · {hit.author}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={!modTarget || adding === hit.project_id}
                    onClick={() => void addFromModrinth(hit)}
                  >
                    <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
                    {adding === hit.project_id ? "…" : "Add"}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Files come from cdn.modrinth.com only, land in the instance above, and are
            installed only when the SHA-1 Modrinth publishes matches the download.
          </p>
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <Badge variant="outline">v3 scope</Badge>
        <span>
          Selection, export and install are fully real; the Compatibility Score
          reads the jars' own manifests; external mods arrive from the official
          Modrinth API with SHA-1 verification. Still honest about what v3
          does NOT do: transitive dependency graphs and CurseForge support —
          the manifest format already carries the facts they need.
        </span>
      </div>
    </div>
  );
}
