import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes,
  Check,
  ChevronRight,
  Coffee,
  Cpu,
  FolderOpen,
  GitBranch,
  Loader2,
  Palette,
  RefreshCw,
  Server as ServerIcon,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NexusMark } from "@/components/brand/NexusLogo";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { useUiStore } from "@/stores/uiStore";
import { detectEnvironment } from "@/services/environment/environmentService";
import { Clock, Play } from "lucide-react";
import { LaunchDialog } from "@/features/projects/workspace/LaunchDialog";
import { formatRelativeTime } from "@/lib/utils";
import type { ProjectRecord } from "@/types";
import { secretsHas, AI_API_KEY_ID } from "@/services/secrets/secretsService";
import { getProviderMeta } from "@/services/ai/providers";
import { openInFileManager } from "@/services/storage/storageService";
import { listServers } from "@/services/db/repositories/serversRepository";
import {
  listShaderInstances,
  listShaderPacks,
} from "@/services/shaders/shaderService";
import { APP_TAGLINE } from "@/lib/constants";
import type { EnvironmentInfo } from "@/types";

export function HomePage() {
  const navigate = useNavigate();
  const ai = useSettingsStore((s) => s.settings.ai);
  const storageBase = useSettingsStore((s) => s.settings.storage.basePath);

  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [env, setEnv] = useState<EnvironmentInfo | null>(null);
  const [envLoading, setEnvLoading] = useState(true);
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const setWizardOpen = useUiStore((s) => s.setCreateWizardOpen);
  const [runProject, setRunProject] = useState<ProjectRecord | null>(null);
  const projects = useProjectsStore((s) => s.projects);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const hydrateProjects = useProjectsStore((s) => s.hydrate);

  useEffect(() => {
    if (!projectsLoaded) void hydrateProjects();
  }, [projectsLoaded, hydrateProjects]);

  // Live workspace stats — real rows from the DB and the workspace folders
  useEffect(() => {
    if (!storageBase) return;
    let cancelled = false;
    void (async () => {
      try {
        const [servers, packs, instances] = await Promise.all([
          listServers().catch(() => []),
          listShaderPacks(storageBase).catch(() => []),
          listShaderInstances(storageBase).catch(() => []),
        ]);
        if (cancelled) return;
        setStats({
          servers: servers.length,
          shaderPacks: packs.length,
          instances: instances.length,
        });
      } catch {
        /* stats are cosmetic — stay quiet on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageBase, projects.length]);

  const provider = getProviderMeta(ai.provider);
  const aiReady =
    ai.model.trim().length > 0 && (!provider.requiresKey || hasKey === true);
  const storageReady = storageBase.trim().length > 0;

  useEffect(() => {
    if (!provider.requiresKey) {
      setHasKey(false);
      return;
    }
    secretsHas(AI_API_KEY_ID)
      .then(setHasKey)
      .catch(() => setHasKey(false));
  }, [ai.provider, provider.requiresKey]);

  const refreshEnv = () => {
    setEnvLoading(true);
    detectEnvironment()
      .then(setEnv)
      .catch(() => setEnv(null))
      .finally(() => setEnvLoading(false));
  };

  useEffect(refreshEnv, []);

  return (
    <div className="relative">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 bg-blueprint-grid opacity-60" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-radial-glow" />

      <div className="relative mx-auto max-w-5xl px-8 py-10">
        {/* Hero */}
        <section className="flex flex-col items-center gap-5 pb-12 pt-6 text-center animate-fade-in">
          <NexusMark className="h-20 w-20 drop-shadow-[0_0_28px_rgba(139,92,246,0.45)]" />
          <div>
            <h1 className="text-4xl font-bold tracking-tight">
              VOXEL{" "}
              <span className="text-brand-gradient">Studio</span>
            </h1>
            <p className="mt-3 text-sm font-medium tracking-wide text-muted-foreground">
              {APP_TAGLINE}
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="gradient" size="lg" onClick={() => navigate("/settings/ai")}>
              <Sparkles className="h-4 w-4" />
              Configure AI
            </Button>
            <Button variant="outline" size="lg" onClick={() => navigate("/settings/general")}>
              Open Settings
            </Button>
          </div>
        </section>

        {/* Workspace stats — real rows, live from the workspace */}
        {projectsLoaded && (projects.length > 0 || (stats && (stats.servers > 0 || stats.shaderPacks > 0))) && (
          <section className="pb-10">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile
                icon={<Boxes className="h-3.5 w-3.5" />}
                value={projects.length}
                label="projects"
                onClick={() => navigate("/projects")}
              />
              <StatTile
                icon={<Palette className="h-3.5 w-3.5" />}
                value={stats?.shaderPacks ?? 0}
                label="shaderpacks"
                onClick={() => navigate("/shaders")}
              />
              <StatTile
                icon={<ServerIcon className="h-3.5 w-3.5" />}
                value={stats?.servers ?? 0}
                label="servers"
                onClick={() => navigate("/servers")}
              />
              <StatTile
                icon={<Play className="h-3.5 w-3.5" />}
                value={stats?.instances ?? 0}
                label="instances"
                onClick={() => navigate("/projects")}
              />
            </div>
          </section>
        )}

        {/* Getting started */}
        <section className="pb-8">
          <SectionHeading
            title="Getting started"
            subtitle="Three steps before your first build"
          />
          <div className="grid gap-4 md:grid-cols-3">
            <SetupCard
              step={1}
              title="Connect an AI provider"
              done={aiReady}
              doneLabel={`${provider.label} ready${ai.model ? ` · ${ai.model}` : ""}`}
              pendingLabel="Add an API key and pick a model"
              actionLabel="Set up AI"
              onAction={() => navigate("/settings/ai")}
            />
            <SetupCard
              step={2}
              title="Choose a storage location"
              done={storageReady}
              doneLabel="Workspace folder ready"
              pendingLabel="Where projects and servers will live"
              actionLabel="Configure storage"
              onAction={() => navigate("/settings/storage")}
            />
            <SetupCard
              step={3}
              title="Create your first project"
              done={projects.length > 0}
              doneLabel={projects.length === 1 ? "1 project created" : `${projects.length} projects created`}
              pendingLabel="A compilable Fabric 1.20.1 workspace, ready to extend"
              actionLabel={projects.length > 0 ? "View projects" : "Create project"}
              onAction={() => {
                if (projects.length > 0) navigate("/projects");
                else setWizardOpen(true);
              }}
            />
          </div>
        </section>

        {/* Continue creating + Environment */}
        <section className="grid gap-4 pb-10 md:grid-cols-5">
          <Card className="md:col-span-3">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Coffee className="h-4 w-4 text-primary" />
                Continue creating
              </CardTitle>
              {projects.length > 0 && (
                <button
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => navigate("/projects")}
                >
                  View all →
                </button>
              )}
            </CardHeader>
            <CardContent>
              {projects.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/80 px-6 py-10 text-center">
                  <div className="rounded-xl bg-secondary/60 p-3">
                    <Terminal className="h-6 w-6 text-muted-foreground/70" />
                  </div>
                  <p className="text-sm font-medium text-foreground/90">
                    No projects yet
                  </p>
                  <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                    Create a Fabric 1.20.1 mod workspace — compilable from the
                    first minute, versioned by git snapshots.
                  </p>
                  <Button variant="gradient" size="sm" onClick={() => setWizardOpen(true)}>
                    Create project
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {projects.slice(0, 4).map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      onOpen={() => navigate(`/projects/${project.id}`)}
                      onRun={() => setRunProject(project)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cpu className="h-4 w-4 text-primary" />
                Environment
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={refreshEnv} title="Refresh">
                <RefreshCw className={"h-4 w-4 " + (envLoading ? "animate-spin" : "")} />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <EnvRow
                loading={envLoading}
                ok={env?.java.found ?? false}
                label="Java"
                value={env?.java.versionString ?? "not found"}
                hint="Needed to compile mods and run Minecraft"
              />
              <EnvRow
                loading={envLoading}
                ok={env?.git.found ?? false}
                label="Git"
                value={env?.git.version ?? "not found"}
                hint="Powers snapshots and version control"
              />
              <EnvRow
                loading={envLoading}
                ok={true}
                label="Platform"
                value={env ? `${env.os} · ${env.arch}` : "…"}
                hint="VOXEL runs fully on your machine"
              />
            </CardContent>
          </Card>
        </section>

        {projects.length > 0 && (
          <LaunchDialog
            project={runProject ?? projects[0]}
            open={runProject !== null}
            onOpenChange={(open) => {
              if (!open) setRunProject(null);
            }}
          />
        )}

        {/* Storage shortcut */}
        {storageReady && (
          <section className="pb-6">
            <button
              onClick={() => void openInFileManager(storageBase).catch(() => {})}
              className="group flex w-full items-center justify-between rounded-xl border border-border/70 bg-card/50 px-5 py-4 text-left transition-colors hover:border-primary/40"
            >
              <div className="flex items-center gap-3">
                <FolderOpen className="h-4 w-4 text-primary" />
                <span className="font-mono text-xs text-muted-foreground">
                  {storageBase}
                </span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  onOpen,
  onRun,
}: {
  project: ProjectRecord;
  onOpen: () => void;
  onRun: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3 text-left transition-colors hover:border-primary/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{project.name}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <Badge variant="default">{project.loader}</Badge>
          <Badge variant="secondary">MC {project.minecraft_version}</Badge>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatRelativeTime(project.updated_at)}
        </span>
        {project.last_build_status && (
          <span className="mt-0.5 flex items-center gap-1 text-[9px] text-muted-foreground/70">
            <span
              className={
                "h-1.5 w-1.5 rounded-full " +
                (project.last_build_status === "success"
                  ? "bg-emerald-400"
                  : project.last_build_status === "failed"
                    ? "bg-red-400"
                    : "bg-muted-foreground/40")
              }
            />
            build {project.last_build_status}
          </span>
        )}
        <span className="mt-1 text-[10px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
          Open →
        </span>
        <button
          className="mt-0.5 rounded-md px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          onClick={(event) => {
            event.stopPropagation();
            onRun();
          }}
          title="Run in Minecraft"
        >
          <Play className="inline h-2.5 w-2.5" /> Run
        </button>
      </div>
    </button>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="pb-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

interface WorkspaceStats {
  servers: number;
  shaderPacks: number;
  instances: number;
}

function StatTile({
  icon,
  value,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex animate-card-rise items-center gap-3 rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-left transition-all hover:border-primary/40 hover:bg-card/80 hover:shadow-[0_8px_28px_rgba(116,47,255,0.14)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block bg-brand-gradient bg-clip-text text-xl font-extrabold leading-none text-transparent">
          {value}
        </span>
        <span className="block text-[11px] text-muted-foreground">{label}</span>
      </span>
      <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function SetupCard({
  step,
  title,
  done,
  doneLabel,
  pendingLabel,
  actionLabel,
  onAction,
  disabled = false,
}: {
  step: number;
  title: string;
  done: boolean;
  doneLabel: string;
  pendingLabel: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute right-0 top-0 h-16 w-16 translate-x-8 -translate-y-8 rounded-full bg-primary/10 blur-2xl" />
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-gradient text-xs font-bold text-white">
            {step}
          </span>
          {done ? (
            <Badge variant="success">
              <Check className="h-3 w-3" /> Done
            </Badge>
          ) : (
            <Badge variant="outline">Pending</Badge>
          )}
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {done ? doneLabel : pendingLabel}
          </p>
        </div>
        <Button
          variant={done ? "secondary" : "default"}
          size="sm"
          onClick={onAction}
          disabled={disabled}
        >
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

function EnvRow({
  loading,
  ok,
  label,
  value,
  hint,
}: {
  loading: boolean;
  ok: boolean;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1">
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <span
            className={
              "block h-2.5 w-2.5 rounded-full " +
              (ok ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" : "bg-red-400")
            }
          />
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <GitBranch className="hidden" />
          <span className="text-xs font-medium text-foreground/90">{label}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {value}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/70">{hint}</p>
      </div>
    </div>
  );
}
