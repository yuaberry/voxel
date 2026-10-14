import { useEffect, useState } from "react";
import { ArchiveRestore, ArrowRight, Camera, FolderOpen, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  ensureStorageDirs,
  getDefaultStorageBase,
  openInFileManager,
  workspaceLegacyStatus,
  workspaceMigrateLegacy,
} from "@/services/storage/storageService";
import { STORAGE_SUBDIRS } from "@/lib/constants";
import { Field, SectionHeader } from "../SettingsBits";
import type { StorageInfo } from "@/types";
import { invoke } from "@tauri-apps/api/core";

export function StorageSettings() {
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const update = useSettingsStore((s) => s.update);
  const [suggested, setSuggested] = useState<string>("");
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const [legacy, setLegacy] = useState<{ exists: boolean; path: string } | null>(null);
  const [snapshotted, setSnapshotted] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const restoreSnapshot = async () => {
    if (!basePath || restoring) return;
    setRestoring(true);
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "VOXEL workspace snapshot", extensions: ["zip"] }],
      });
      if (typeof picked !== "string") return;
      const result = await invoke<{
        restored: string[];
        skipped: string[];
        snapshotCreatedAt: string;
      }>("workspace_import_snapshot", { basePath, zipPath: picked });
      const restoredN = result.restored.length;
      const skippedN = result.skipped.length;
      if (restoredN === 0 && skippedN > 0) {
        toast.info("Nothing restored", {
          description: `${skippedN} item(s) already exist here — restores never overwrite. The snapshot is from ${result.snapshotCreatedAt}.`,
          duration: 9000,
        });
      } else {
        toast.success("Snapshot restored", {
          description: `${restoredN} file(s) restored${skippedN > 0 ? `, ${skippedN} skipped (already exist — nothing is ever overwritten)` : ""} · snapshot from ${result.snapshotCreatedAt}`,
          duration: 10000,
        });
      }
    } catch (error) {
      toast.error("Restore failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRestoring(false);
    }
  };

  const exportSnapshot = async () => {
    if (!basePath) return;
    setSnapshotted(true);
    try {
      const result = await invoke<{
        zipPath: string;
        fileCount: number;
        projects: number;
        shaderPacks: number;
        modpacks: number;
        bytes: number;
      }>("workspace_export_snapshot", { basePath });
      toast.success("Workspace snapshot created", {
        description: `${result.fileCount} files (${result.projects} projects · ${result.shaderPacks} shaders · ${result.modpacks} modpacks) · ${(result.bytes / 1048576).toFixed(1)} MB`,
        duration: 9000,
      });
      void openInFileManager(result.zipPath);
    } catch (error) {
      toast.error("Snapshot failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSnapshotted(false);
    }
  };
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    getDefaultStorageBase().then(setSuggested).catch(() => setSuggested(""));
    void workspaceLegacyStatus().then(setLegacy).catch(() => setLegacy(null));
  }, []);

  const migrateLegacy = async () => {
    setMigrating(true);
    try {
      const newPath = await workspaceMigrateLegacy();
      await applyBasePath(newPath);
      setLegacy(null);
      toast.success("Workspace moved to ~/Voxel", {
        description: "Everything (projects, instances, servers, backups) came along — same disk move.",
      });
    } catch (error) {
      toast.error("Could not move the workspace", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setMigrating(false);
    }
  };

  const applyBasePath = async (path: string) => {
    setBusy(true);
    try {
      const result = await ensureStorageDirs(path);
      setInfo(result);
      await update("storage", { basePath: result.basePath });
      const created = result.dirs.filter((d) => d.created).length;
      toast.success("Storage location configured", {
        description:
          created > 0
            ? `Created ${created} folder${created === 1 ? "" : "s"} under ${result.basePath}`
            : `All folders verified under ${result.basePath}`,
      });
    } catch (error) {
      toast.error("Could not configure storage location", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Choose storage location" });
    if (typeof selected === "string" && selected.length > 0) {
      await applyBasePath(selected);
    }
  };

  return (
    <section>
      <SectionHeader
        title="Storage"
        description="Everything VOXEL creates — projects, instances, servers, backups — lives under one workspace folder."
      />

      {legacy?.exists && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Legacy workspace detected</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="font-mono">{legacy.path}</span> is from the old
              brand era. Move it to <span className="font-mono">~/Voxel</span> in one
              click — same-disk move, nothing is copied or lost.
            </p>
          </div>
          <Button variant="gradient" size="sm" disabled={migrating} onClick={() => void migrateLegacy()}>
            {migrating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            {migrating ? "Moving…" : "Move to ~/Voxel"}
          </Button>
        </div>
      )}

      <Field
        label="Workspace snapshot"
        hint="One zip with your AUTHORED work — projects (sources + .voxel memory), shaderpacks and modpacks. Downloaded instances and server worlds are excluded: they are re-creatable products, and the snapshot manifest says so."
      >
        <div className="max-w-md">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!basePath || snapshotted} onClick={() => void exportSnapshot()}>
              <Camera className="mr-2 h-3.5 w-3.5" />
              {snapshotted ? "Creating…" : "Export snapshot"}
            </Button>
            <Button variant="outline" size="sm" disabled={!basePath || restoring} onClick={() => void restoreSnapshot()}>
              <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
              {restoring ? "Restoring…" : "Restore snapshot…"}
            </Button>
          </div>
        </div>
      </Field>

      <Field
        label="Workspace folder"
        hint="Projects, test instances, servers and backups are organized in subfolders here."
      >
        <div className="max-w-md space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 flex-1 items-center gap-2 rounded-md border border-input bg-background/60 px-3">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
              <span className="truncate font-mono text-xs">
                {basePath || suggested || "—"}
              </span>
            </div>
            <Button onClick={() => void pickFolder()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Browse…
            </Button>
          </div>

          {!basePath && suggested && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void applyBasePath(suggested)}
              disabled={busy}
            >
              Use default: <span className="font-mono text-xs">{suggested}</span>
            </Button>
          )}

          {basePath && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={info ? "success" : "outline"}>
                {info ? "Folders ready" : "Configured"}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void openInFileManager(basePath).catch((error) =>
                    toast.error("Could not open folder", {
                      description: String(error),
                    }),
                  )
                }
              >
                <FolderOpen className="h-4 w-4" />
                Open in file manager
              </Button>
            </div>
          )}
        </div>
      </Field>

      <Field
        label="Folder layout"
        hint="Fixed structure — never mix projects, instances or servers manually."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {STORAGE_SUBDIRS.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between rounded-md border border-border/60 bg-card/40 px-3 py-2"
            >
              <span className="font-mono text-xs text-foreground/90">{name}/</span>
              <span className="text-[11px] text-muted-foreground/70">
                {name === "projects" && "Mod & content projects"}
                {name === "instances" && "Isolated Minecraft test instances"}
                {name === "servers" && "Local server installs"}
                {name === "backups" && "Backup archives & restore points"}
                {name === "logs" && "Build & server logs"}
                {name === ".gradle-cache" && "Shared Gradle cache (faster builds)"}
              </span>
            </div>
          ))}
        </div>
      </Field>
    </section>
  );
}
