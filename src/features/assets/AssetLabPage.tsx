import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { toast } from "sonner";
import { FileImage, Loader2, RefreshCw, SearchCheck, ShieldAlert, Upload } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
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
  checkProjectConsistency,
  findDuplicateTextures,
  scanWorkspaceAssets,
  importTexture,
  type AssetEntry,
  type AssetKind,
  type ConsistencyIssue,
  type DuplicateGroup,
} from "@/services/assets/assetLab";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<AssetKind, string> = {
  texture: "textures",
  model: "models",
  lang: "lang",
  recipe: "recipes",
  structure: "structures",
  advancement: "advancements",
  shader: "shaders",
  sound: "sounds",
  other: "other",
};

/**
 * VOXEL Asset Lab — the real workspace asset library with the consistency
 * checker: every texture/model/lang/recipe/structure across projects, the
 * broken references and missing files per project, duplicates by byte-hash,
 * and validated image imports (real PNG header inspection).
 */
export function AssetLabPage() {
  const projects = useProjectsStore((s) => s.projects);
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const [tab, setTab] = useState<"library" | "checker">("library");
  const [assets, setAssets] = useState<AssetEntry[] | null>(null);
  const [filterKind, setFilterKind] = useState<AssetKind | "all">("all");
  const [query, setQuery] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const [issues, setIssues] = useState<ConsistencyIssue[] | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [checkingProject, setCheckingProject] = useState("");
  const [busy, setBusy] = useState(false);

  // import dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [importProjectId, setImportProjectId] = useState("");
  const [importId, setImportId] = useState("");
  const [importSource, setImportSource] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!basePath) return;
    try {
      const scanned = await scanWorkspaceAssets(basePath, projects);
      setAssets(scanned);
      // preview the first textures (real base64 reads, capped)
      const first = scanned.filter((a) => a.kind === "texture").slice(0, 24);
      const loaded: Record<string, string> = {};
      for (const asset of first) {
        try {
          const result = await invoke<{ data: string }>("read_project_file_base64", {
            basePath,
            rel: asset.rel,
          });
          loaded[asset.rel] = `data:image/png;base64,${result.data}`;
        } catch {
          continue;
        }
      }
      setPreviews(loaded);
    } catch (error) {
      toast.error("Could not scan the assets", {
        description: error instanceof Error ? error.message : String(error),
      });
      setAssets([]);
    }
  }, [basePath, projects]);

  // React's "adjust state during render": the first project becomes both
  // selections the moment projects arrive — no effect, no sync writes
  if (projects.length > 0 && !checkingProject) {
    setCheckingProject(projects[0].id);
  }
  if (projects.length > 0 && !importProjectId) {
    setImportProjectId(projects[0].id);
  }

  useEffect(() => {
    // microtask: refresh settles state synchronously on failure paths
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const shown = useMemo(() => {
    if (!assets) return [];
    return assets
      .filter((a) => filterKind === "all" || a.kind === filterKind)
      .filter((a) => !query.trim() || a.rel.toLowerCase().includes(query.trim().toLowerCase()))
      .slice(0, 300);
  }, [assets, filterKind, query]);

  const runChecker = useCallback(async () => {
    const project = projects.find((p) => p.id === checkingProject);
    if (!basePath || !project) return;
    setBusy(true);
    setIssues(null);
    try {
      const [projectIssues, dups] = await Promise.all([
        checkProjectConsistency(basePath, project),
        (async () => {
          const all = await scanWorkspaceAssets(basePath, [project]);
          return findDuplicateTextures(basePath, all);
        })(),
      ]);
      setIssues(projectIssues);
      setDuplicates(dups);
      const broken = projectIssues.filter((i) => i.severity === "broken").length;
      const missing = projectIssues.filter((i) => i.severity === "missing").length;
      toast[projectIssues.length === 0 ? "success" : "warning"](
        projectIssues.length === 0
          ? "Everything checks out"
          : `${projectIssues.length} findings`,
        {
          description:
            projectIssues.length === 0
              ? "No broken references, no missing files, no orphans."
              : `${broken} broken · ${missing} missing · ${projectIssues.length - broken - missing} other`,
          duration: 10000,
        },
      );
    } catch (error) {
      toast.error("Could not run the checker", {
        description: error instanceof Error ? error.message : String(error),
      });
      setIssues([]);
    } finally {
      setBusy(false);
    }
  }, [basePath, checkingProject, projects]);

  const handleImport = async () => {
    const project = projects.find((p) => p.id === importProjectId);
    if (!project || !basePath || busy) return;
    if (!importSource) {
      toast.warning("Choose the image file first");
      return;
    }
    setBusy(true);
    try {
      const result = await importTexture(basePath, project, importId.trim(), importSource);
      if (result.accepted) {
        toast.success("Texture imported", {
          description: `${result.rel} — validated square PNG. Wire it to an item in the Gameplay Designer.`,
          duration: 10000,
        });
        setImportOpen(false);
        setImportId("");
        setImportSource(null);
        await refresh();
      } else {
        toast.error("Import rejected — the file was removed", {
          description: result.reason,
          duration: 10000,
        });
      }
    } catch (error) {
      toast.error("Import failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async () => {
    const picked = await openFileDialog({
      multiple: false,
      title: "Choose a texture PNG (16/32/64/128 square)",
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (typeof picked === "string") setImportSource(picked);
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="bg-gradient-to-r from-brand-purple to-brand-cyan bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
            {t("Asset Lab")}
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t(
              "Every real asset across your projects — with the consistency checker: broken references, missing files, orphan lang keys and duplicate textures.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("Rescan")}
          </Button>
          <Button size="sm" variant="gradient" onClick={() => setImportOpen(true)} disabled={projects.length === 0}>
            <Upload className="h-3.5 w-3.5" />
            {t("Import texture")}
          </Button>
        </div>
      </div>

      <div className="mt-5 flex gap-1.5">
        {(["library", "checker"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              tab === value
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-primary/30",
            )}
          >
            {value === "library" ? t("Library") : t("Consistency checker")}
          </button>
        ))}
      </div>

      {tab === "library" ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search assets…")}
              className="h-9 w-64 text-xs"
            />
            <Select value={filterKind} onValueChange={(v) => setFilterKind(v as AssetKind | "all")}>
              <SelectTrigger className="h-9 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All types")}</SelectItem>
                {(Object.keys(KIND_LABEL) as AssetKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {assets && (
              <Badge variant="outline">
                {shown.length} / {assets.length}
              </Badge>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((asset) => (
              <div key={asset.rel} className="rounded-xl border border-border/70 bg-card/60 p-3">
                {asset.kind === "texture" && previews[asset.rel] ? (
                  <img
                    src={previews[asset.rel]}
                    alt={asset.name}
                    className="h-24 w-24 rounded-lg border border-border/60 bg-secondary/40"
                    style={{ imageRendering: "pixelated" }}
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-border/60 bg-secondary/40">
                    <FileImage className="h-7 w-7 text-muted-foreground/40" />
                  </div>
                )}
                <p className="mt-2 truncate font-mono text-[10px] text-foreground/90" title={asset.rel}>
                  {asset.name}
                </p>
                <p className="mt-0.5 flex items-center justify-between gap-1 text-[9px] text-muted-foreground">
                  <span>{asset.projectSlug || "workspace"}</span>
                  <span>{(asset.sizeBytes / 1024).toFixed(1)} KB</span>
                </p>
              </div>
            ))}
          </div>
          {assets !== null && shown.length === 0 && (
            <p className="mt-8 rounded-xl border border-dashed border-border/70 px-6 py-12 text-center text-xs text-muted-foreground">
              {t("No assets match — create content in the Studio or with the agent first.")}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Select value={checkingProject} onValueChange={setCheckingProject}>
              <SelectTrigger className="w-64 text-xs">
                <SelectValue placeholder={t("Project")} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="gradient" onClick={() => void runChecker()} disabled={busy || !checkingProject}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
              {t("Run the checker")}
            </Button>
          </div>

          {issues === null ? (
            <p className="mt-8 text-center text-xs text-muted-foreground">
              {t("Run the checker to read the real files and find inconsistencies.")}
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {issues.length === 0 && duplicates.length === 0 ? (
                <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-400">
                  {t("All green — no broken references, no missing files, no orphans, no duplicates.")}
                </p>
              ) : (
                <>
                  {issues.map((issue, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                        issue.severity === "broken" && "border-red-500/40 bg-red-500/5",
                        issue.severity === "missing" && "border-amber-500/40 bg-amber-500/5",
                        issue.severity === "orphan" && "border-border/60 bg-card/50",
                      )}
                    >
                      {issue.severity === "broken" ? (
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                      ) : null}
                      <p className="leading-relaxed">{issue.message}</p>
                    </div>
                  ))}
                  {duplicates.map((group) => (
                    <div key={group.hash} className="rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-xs">
                      <p className="font-semibold">{t("Duplicate textures (identical bytes)")}</p>
                      {group.rels.map((rel) => (
                        <p key={rel} className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{rel}</p>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Import texture")}</DialogTitle>
            <DialogDescription>
              {t(
                "Bring your own PNG — validated for real (square, 16/32/64/128, ≤1MB). Invalid files are removed immediately, never left behind.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("Project")}</Label>
              <Select value={importProjectId} onValueChange={setImportProjectId}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Texture id (registry name)")}</Label>
              <Input
                className="font-mono text-xs"
                placeholder="ruby_gem"
                value={importId}
                onChange={(e) => setImportId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Image file")}</Label>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 truncate" onClick={() => void pickFile()}>
                  <Upload className="h-3.5 w-3.5" />
                  {importSource ? importSource.split(/[\\/]/).pop() : t("Choose PNG…")}
                </Button>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={() => setImportOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              size="sm"
              variant="gradient"
              onClick={() => void handleImport()}
              disabled={busy || !importId.trim() || !importSource}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("Import texture")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
