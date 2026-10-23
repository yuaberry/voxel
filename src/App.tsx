import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DiagnosticsDialog } from "@/components/DiagnosticsDialog";
import { Button } from "@/components/ui/button";
import { Stethoscope } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { HomePage } from "@/features/home/HomePage";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { ProjectWorkspacePage } from "@/features/projects/workspace/ProjectWorkspacePage";
import { AiCreatorPage } from "@/features/ai-creator/AiCreatorPage";
import { ServersPage } from "@/features/servers/ServersPage";
import { ShadersPage } from "@/features/shaders/ShadersPage";
import { LauncherPage } from "@/features/launcher/LauncherPage";
import { ModpacksPage } from "@/features/modpacks/ModpacksPage";
import { AssetStudioPage } from "@/features/studio/AssetStudioPage";
import { MarketplacePage } from "@/features/marketplace/MarketplacePage";
import { VisualLogicPage } from "@/features/logic/VisualLogicPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

export default function App() {
  const loaded = useSettingsStore((s) => s.loaded);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const loadError = useSettingsStore((s) => s.loadError);
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const accent = useSettingsStore((s) => s.settings.appearance.accent);
  const reduceMotion = useSettingsStore((s) => s.settings.appearance.reduceMotion);

  const hydrateProjects = useProjectsStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
    void hydrateProjects();
    // Version catalog auto-refresh on boot (12h TTL — no-op when fresh)
    import("@/services/minecraft/versionCatalog")
      .then((m) => m.ensureCatalog().catch(() => {}))
      .catch(() => {});
    // Scheduled workspace snapshots — after settings hydrate, once per open
    const store = useSettingsStore;
    const t = setTimeout(() => {
      const { basePath, autoSnapshotDays } = store.getState().settings.storage;
      if (!basePath || !autoSnapshotDays) return;
      import("@tauri-apps/api/core")
        .then(({ invoke }) =>
          invoke<{ created: { fileCount: number } | null } | null>(
            "snapshot_auto_check",
            { basePath, cadenceDays: autoSnapshotDays },
          ).catch(() => null),
        )
        .then((result) => {
          if (result?.created) {
            import("sonner").then(({ toast }) =>
              toast.success("Automatic workspace snapshot", {
                description: `${result.created!.fileCount} authored files backed up (daily cadence).`,
              }),
            );
          }
        })
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, [hydrate, hydrateProjects]);

  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const projectsCount = useProjectsStore((s) => s.projects.length);
  const addProject = useProjectsStore((s) => s.addProject);

  // Briefing §52 — the Dark Kingdom example materializes on first run:
  // only when a workspace exists and no projects are registered. If the
  // folder is already on disk, the Rust guard refuses the duplicate and
  // this stays silent.
  useEffect(() => {
    if (!loaded || !projectsLoaded || projectsCount > 0) return;
    const basePath = useSettingsStore.getState().settings.storage.basePath;
    if (!basePath) return;

    void (async () => {
      try {
        const { resolveTemplateParams, templateParamsToPayload } =
          await import("@/services/minecraft/versionCatalog");
        const { createProject, defaultPackageFor } =
          await import("@/services/projects/projectsService");
        const { insertProject } = await import(
          "@/services/db/repositories/projectsRepository"
        );

        const settings = useSettingsStore.getState().settings;
        const params = await resolveTemplateParams(settings.minecraft.defaultVersion);

        // Idempotent by design: StrictMode double-mounts in dev, and a folder
        // may survive a previous run — if the scaffold already exists, adopt
        // it instead of failing.
        let projectPath: string;
        try {
          const result = await createProject({
            storageBase: basePath,
            slug: "dark-kingdom",
            name: "Dark Kingdom",
            template: "fabric-1.20.1-mod",
            modId: "dark_kingdom",
            modIdClass: "DarkKingdom",
            package: defaultPackageFor("dark_kingdom"),
            description:
              "The VOXEL example project — a dark medieval sword, recipe and advancement to build upon.",
            license: settings.general.defaultLicense,
            author: settings.general.authorName || "VOXEL",
            ...templateParamsToPayload(params, "fabric"),
          });
          projectPath = result.projectPath;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const existing = `${basePath}/projects/dark-kingdom`;
          if (message.includes("already exists")) {
            projectPath = existing; // adopt the existing scaffold
          } else {
            throw error;
          }
        }

        const now = new Date().toISOString();
        const record = {
          id: crypto.randomUUID(),
          name: "Dark Kingdom",
          slug: "dark-kingdom",
          type: "mod" as const,
          minecraft_version: params.minecraftVersion,
          loader: "fabric" as const,
          description:
            "The VOXEL example project — a dark medieval sword, recipe and advancement to build upon.",
          license: settings.general.defaultLicense,
          path: projectPath,
          repository_url: null,
          status: "active",
          last_build_status: null,
          last_build_at: null,
          created_at: now,
          updated_at: now,
        };
        await insertProject(record);
        addProject(record);
        toast.success("Example project: Dark Kingdom", {
          description: "Sword, recipe and advancement — Build it, then Run it.",
        });
      } catch (error) {
        // Quiet in the UI, loud in the logs table — observability by design
        console.info("Dark Kingdom example not created:", error);
        const message = error instanceof Error ? error.message : String(error);
        void import("@/services/db/client")
          .then(async ({ getDb }) => {
            const db = await getDb();
            await db.execute(
              "INSERT INTO logs (level, source, message) VALUES ('warn', 'example', $1)",
              [`dark-kingdom skipped: ${message}`.slice(0, 2000)],
            );
          })
          .catch(() => {});
      }
    })();
  }, [loaded, projectsLoaded, projectsCount, addProject]);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    document.documentElement.dataset.reduceMotion = String(reduceMotion);
  }, [accent, reduceMotion]);

  return (
    <ErrorBoundary>
    <TooltipProvider delayDuration={200}>
      <HashRouter>
        {loaded ? (
          <>
            {/* Emergency banner: a failed settings load (dead/locked database)
                used to leave the app silently broken — "nothing works". Now
                it says WHAT is wrong and offers the real diagnosis. */}
            {loadError ? (
              <div className="fixed inset-x-0 top-0 z-[70] border-b border-destructive/50 bg-destructive/15 px-4 py-2 backdrop-blur-md">
                <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-[11px] leading-snug text-destructive">
                    <span className="font-bold">Database problem: </span>
                    <span className="break-words">
                      your lists and settings cannot be saved right now ({loadError}).
                      Creating servers/projects may still work — but nothing will be remembered.
                    </span>
                  </p>
                  <DiagnosticsDialog
                    basePath={basePath}
                    trigger={
                      <Button size="sm" variant="outline" className="shrink-0">
                        <Stethoscope className="h-3.5 w-3.5" />
                        Run diagnostics
                      </Button>
                    }
                  />
                </div>
              </div>
            ) : null}
            <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<HomePage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="launcher" element={<LauncherPage />} />
              <Route path="modpacks" element={<ModpacksPage />} />
              <Route path="studio" element={<AssetStudioPage />} />
              <Route path="marketplace" element={<MarketplacePage />} />
              <Route path="logic" element={<VisualLogicPage />} />
              <Route path="projects/:projectId" element={<ProjectWorkspacePage />} />
              <Route path="ai-creator" element={<AiCreatorPage />} />
              <Route path="servers" element={<ServersPage />} />
              <Route path="shaders" element={<ShadersPage />} />
              <Route path="settings" element={<Navigate to="/settings/general" replace />} />
              <Route path="settings/:section" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          </>
        ) : (
          <SplashScreen />
        )}
      </HashRouter>
      <Toaster />
    </TooltipProvider>
    </ErrorBoundary>
  );
}

function SplashScreen() {
  return (
    <div className="relative flex h-screen w-full flex-col items-center justify-center gap-7 overflow-hidden bg-radial-glow">
      <div className="pointer-events-none absolute inset-0 bg-blueprint-grid" aria-hidden="true" />
      <div className="relative animate-pulse-soft">
        <svg
          viewBox="0 0 64 64"
          className="h-20 w-20 drop-shadow-[0_0_36px_rgba(145,85,255,0.55)]"
          fill="none"
        >
          <polygon points="32,10 52,20 32,30 12,20" fill="#9155ff" />
          <polygon points="12,20 32,30 32,52 12,42" fill="#3580f7" />
          <polygon points="52,20 32,30 32,52 52,42" fill="#7c3aed" />
          <circle cx="32" cy="10" r="2.6" fill="#3ee7fb" />
          <circle cx="52" cy="20" r="2.6" fill="#3ee7fb" />
          <circle cx="12" cy="20" r="2.6" fill="#3ee7fb" />
          <circle cx="32" cy="52" r="2.6" fill="#3ee7fb" />
        </svg>
      </div>
      <div className="relative flex flex-col items-center gap-2">
        <div className="text-2xl font-extrabold tracking-[0.34em] text-foreground">
          VOXEL
        </div>
        <div className="text-brand-gradient text-[11px] font-semibold tracking-[0.22em]">
          IMAGINE · CREATE · BUILD · PLAY
        </div>
      </div>
    </div>
  );
}
