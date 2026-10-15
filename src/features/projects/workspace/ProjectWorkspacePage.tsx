import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { ChevronRight, Github, Loader2, Play, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
  createProjectDirectory,
  deleteProjectEntry,
  renameProjectEntry,
} from "@/services/projects/projectsService";
import { touchProject } from "@/services/db/repositories/projectsRepository";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { setupMonacoTheme, languageFromPath, registerSaveShortcut } from "@/lib/monaco";
import { cn } from "@/lib/utils";
import { FileTree } from "./FileTree";
import { SnapshotPanel } from "./SnapshotPanel";
import { BuildDrawer } from "./BuildDrawer";
import { LaunchDialog } from "./LaunchDialog";
import { PublishDialog } from "./PublishDialog";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import type { ProjectFileEntry } from "@/types";

interface OpenTab {
  path: string;
  content: string;
  savedContent: string;
}

export function ProjectWorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);

  const projects = useProjectsStore((s) => s.projects);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const hydrateProjects = useProjectsStore((s) => s.hydrate);
  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const projectRel = useMemo(() => (project ? `projects/${project.slug}` : ""), [project]);

  const activeTab = tabs.find((t) => t.path === activePath) ?? null;
  const dirty = activeTab ? activeTab.content !== activeTab.savedContent : false;
  const editorRef = useRef<unknown>(null);

  // ---- load project (store-first; App guarantees hydration) ----
  useEffect(() => {
    if (!projectsLoaded) {
      void hydrateProjects();
      return;
    }
    if (!project) {
      toast.error("Project not found");
      navigate("/projects", { replace: true });
    }
  }, [projectsLoaded, project, hydrateProjects, navigate]);

  const refreshFiles = useCallback(async () => {
    if (!basePath || !projectRel) return;
    setFilesLoading(true);
    try {
      setFiles(await listProjectFiles(basePath, projectRel));
    } catch (error) {
      toast.error("Could not list files", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setFilesLoading(false);
    }
  }, [basePath, projectRel]);

  useEffect(() => {
    if (project) void refreshFiles();
  }, [project, refreshFiles]);

  useEffect(() => {
    setupMonacoTheme();
  }, []);

  // ---- tabs ----
  const openFile = useCallback(
    async (relPath: string) => {
      if (!basePath || !projectRel) return;
      const existing = tabs.find((t) => t.path === relPath);
      if (existing) {
        setActivePath(relPath);
        return;
      }
      try {
        const content = await readProjectFile(basePath, `${projectRel}/${relPath}`);
        setTabs((prev) => [...prev, { path: relPath, content, savedContent: content }]);
        setActivePath(relPath);
      } catch (error) {
        toast.error("Could not open file", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [basePath, projectRel, tabs],
  );

  const closeTab = (relPath: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== relPath);
      if (activePath === relPath) {
        const last = next[next.length - 1];
        setActivePath(last ? last.path : null);
      }
      return next;
    });
  };

  const saveActive = useCallback(async () => {
    if (!activeTab || !basePath || !projectRel) return;
    try {
      await writeProjectFile(basePath, `${projectRel}/${activeTab.path}`, activeTab.content);
      setTabs((prev) =>
        prev.map((t) =>
          t.path === activeTab.path ? { ...t, savedContent: t.content } : t,
        ),
      );
      if (projectId) await touchProject(projectId);
      toast.success(`Saved ${activeTab.path.split("/").pop()}`);
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [activeTab, basePath, projectRel, projectId]);

  const onContentChange = (value: string | undefined) => {
    if (!activePath || value === undefined) return;
    setTabs((prev) =>
      prev.map((t) => (t.path === activePath ? { ...t, content: value } : t)),
    );
  };

  // ---- fs operations ----
  const handleCreateFile = async (relPath: string) => {
    if (!basePath || !projectRel) return;
    await writeProjectFile(basePath, `${projectRel}/${relPath}`, "");
    await refreshFiles();
    await openFile(relPath);
    toast.success(`Created ${relPath}`);
  };

  const handleCreateFolder = async (relPath: string) => {
    if (!basePath || !projectRel) return;
    await createProjectDirectory(basePath, `${projectRel}/${relPath}`);
    await refreshFiles();
    toast.success(`Created ${relPath}/`);
  };

  const handleDelete = async (relPath: string) => {
    if (!basePath || !projectRel) return;
    await deleteProjectEntry(basePath, `${projectRel}/${relPath}`);
    setTabs((prev) => prev.filter((t) => !t.path.startsWith(relPath)));
    if (activePath && (activePath === relPath || activePath.startsWith(`${relPath}/`))) {
      setActivePath(null);
    }
    await refreshFiles();
    toast.success(`Deleted ${relPath}`);
  };

  const handleRename = async (relPath: string, newName: string) => {
    if (!basePath || !projectRel) return;
    await renameProjectEntry(basePath, `${projectRel}/${relPath}`, newName);
    setTabs((prev) => prev.filter((t) => !t.path.startsWith(relPath)));
    if (activePath && (activePath === relPath || activePath.startsWith(`${relPath}/`))) {
      setActivePath(null);
    }
    await refreshFiles();
    toast.success("Renamed");
  };

  if (!project || !basePath) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Project header */}
      <div className="flex items-center justify-between border-b border-border/60 bg-card/30 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => navigate("/projects")}
          >
            Projects
          </button>
          <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
          <span className="truncate text-sm font-semibold">{project.name}</span>
          <Badge variant="default" className="ml-1">
            {project.loader} · MC {project.minecraft_version}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:border-destructive/50 hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            title="Delete this project permanently"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPublishOpen(true)}
            title="Publish to GitHub"
          >
            <Github className="h-3.5 w-3.5" />
            Publish
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLaunchOpen(true)} title="Run in Minecraft">
            <Play className="h-3.5 w-3.5" />
            Run
          </Button>
          <Button
            size="sm"
            variant={dirty ? "gradient" : "secondary"}
            onClick={() => void saveActive()}
            disabled={!activeTab || !dirty}
          >
            <Save className="h-3.5 w-3.5" />
            {dirty ? "Save" : "Saved"}
          </Button>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_280px]">
        <div className="min-h-0 border-r border-border/60">
          <FileTree
            entries={files}
            activePath={activePath}
            loading={filesLoading}
            onOpenFile={(path) => void openFile(path)}
            onRefresh={() => void refreshFiles()}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onDelete={handleDelete}
            onRename={handleRename}
          />
        </div>

        <div className="flex min-h-0 flex-col">
          {/* Tabs */}
          <div className="flex h-9 items-center gap-1 overflow-x-auto border-b border-border/60 px-1">
            {tabs.length === 0 && (
              <span className="px-3 text-[11px] text-muted-foreground/50">
                Open a file from the explorer to start editing
              </span>
            )}
            {tabs.map((tab) => {
              const tabDirty = tab.content !== tab.savedContent;
              return (
                <div
                  key={tab.path}
                  className={cn(
                    "group flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                    tab.path === activePath
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  <button
                    className="max-w-[160px] truncate"
                    onClick={() => setActivePath(tab.path)}
                    title={tab.path}
                  >
                    {tab.path.split("/").pop()}
                  </button>
                  {tabDirty && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                  <button
                    className="opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100"
                    onClick={() => closeTab(tab.path)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Monaco */}
          <div className="min-h-0 flex-1">
            {activeTab ? (
              <Editor
                key={activeTab.path}
                height="100%"
                language={languageFromPath(activeTab.path)}
                value={activeTab.content}
                onChange={onContentChange}
                theme="voxel-dark"
                onMount={(editor) => {
                  editorRef.current = editor;
                  setEditorReady(true);
                  registerSaveShortcut(editor, () => void saveActive());
                }}
                options={{
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontLigatures: true,
                  minimap: { enabled: true, renderCharacters: false },
                  smoothScrolling: true,
                  cursorSmoothCaretAnimation: "on",
                  renderLineHighlight: "all",
                  padding: { top: 12, bottom: 12 },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 4,
                  readOnly: false,
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-blueprint-grid">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    Select a file to edit
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    Monaco Editor · Java · JSON · Gradle
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className="flex h-6 items-center justify-between border-t border-border/60 px-3 text-[10px] text-muted-foreground/70">
            <span className="truncate font-mono">
              {activeTab ? activeTab.path : "—"}
            </span>
            <span>
              {activeTab ? languageFromPath(activeTab.path) : ""}
              {dirty ? " · unsaved" : ""}
              {editorReady && activeTab ? " · Ctrl+S to save" : ""}
            </span>
          </div>
        </div>

        <div className="min-h-0 border-l border-border/60">
          <SnapshotPanel
            basePath={basePath}
            projectRel={projectRel}
            onAfterRestore={async () => {
              // Reopen active tab from disk after a restore
              const current = activePath;
              setTabs([]);
              setActivePath(null);
              await refreshFiles();
              if (current) await openFile(current);
            }}
          />
        </div>
      </div>

      {/* Run Minecraft with this mod */}
      <LaunchDialog project={project} open={launchOpen} onOpenChange={setLaunchOpen} />

      {/* Publish to GitHub */}
      <PublishDialog project={project} open={publishOpen} onOpenChange={setPublishOpen} />

      {/* Permanent delete — the owner kept looking for it INSIDE the project */}
      <DeleteProjectDialog
        project={deleteOpen ? project : null}
        onClose={() => setDeleteOpen(false)}
        redirectTo="/projects"
      />

      {/* Build drawer — terminal, Error Center, Auto-Fix */}
      <BuildDrawer
        project={project}
        open={drawerOpen}
        onToggle={setDrawerOpen}
        buildStatus={project.last_build_status}
      />
    </div>
  );
}
