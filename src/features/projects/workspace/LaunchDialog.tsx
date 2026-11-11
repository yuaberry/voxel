import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Loader2, Play, ShieldCheck, Square } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectRecord } from "@/types";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  copyModJar,
  launchGame,
  prepareInstance,
  registerInstance,
  resolveLoaderVersion,
  runtimeLoaderFor,
  runtimeStatus,
  stopGame,
  type LaunchProgress,
  type PrepareResult,
  type RuntimeStatus,
} from "@/services/launcher/instanceService";
import {
  getLaunchAccount,
  getStoredAccount,
} from "@/services/launcher/accountService";
import type { MinecraftAccount } from "@/types";

interface Props {
  project: ProjectRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Phase = "idle" | "checking" | "downloading" | "running";

/**
 * Run dialog — prepares the isolated instance (official downloads with
 * progress), deploys the compiled mod jar (when the project HAS one) and
 * launches Minecraft.
 *
 * Two rules learned from the owner's report:
 * 1. The instance folder existing does NOT mean the game can start — the
 *    runtime (client.jar, libraries, assets, natives) is probed for real.
 * 2. A datapack project has NO mod jar — that is correct, not an error.
 */
export function LaunchDialog({ project, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const ramMb = useSettingsStore((s) => s.settings.launcher.ramMb);
  const javaPath = useSettingsStore((s) => s.settings.java.customJavaPath);
  const elyClientId = useSettingsStore((s) => s.settings.launcher.elyClientId);

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<LaunchProgress | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [modJar, setModJar] = useState<string | null>(null);
  const [account, setAccount] = useState<MinecraftAccount | null>(null);
  const [gameLog, setGameLog] = useState<string[]>([]);
  const runningRef = useRef(false);

  const slug = project.slug;
  const loader = runtimeLoaderFor(project);
  const isVanilla = loader === "vanilla";
  const busy = phase === "checking" || phase === "downloading";
  const accountProvider = account?.provider === "elyby" ? "Ely.by" : "Microsoft";
  const runtimeReady = runtime?.ready === true;

  const refreshStatus = useCallback(async () => {
    if (!basePath) return;
    setPhase("checking");
    try {
      const status = await runtimeStatus(
        basePath,
        project.minecraft_version,
        loader,
        slug,
      ).catch(() => null);
      const [stored, jar] = await Promise.all([
        getStoredAccount().catch(() => null),
        isVanilla
          ? Promise.resolve(null)
          : copyModJar(basePath, slug, `projects/${slug}`).catch(() => null),
      ]);
      // a failed probe is a state too — never an eternal "checking…"
      setRuntime(
        status ?? {
          ready: false,
          mcVersion: project.minecraft_version,
          loader,
          missing: ["runtime status unavailable"],
        },
      );
      setAccount(stored);
      setModJar(jar);
    } finally {
      setPhase((current) => (current === "checking" ? "idle" : current));
    }
  }, [basePath, slug, project.minecraft_version, loader, isVanilla]);

  useEffect(() => {
    if (!open) return;
    // microtask: refreshStatus settles phase synchronously on failure paths
    void Promise.resolve().then(() => refreshStatus());
  }, [open, refreshStatus]);

  /** Downloads the official runtime when it is missing. */
  const ensureRuntime = async (): Promise<PrepareResult> => {
    const loaderVersion = await resolveLoaderVersion(project);
    const result = await prepareInstance(
      basePath,
      slug,
      project.minecraft_version,
      loader,
      loaderVersion,
      (p) => setProgress(p),
    );
    await registerInstance({
      id: crypto.randomUUID(),
      projectId: project.id,
      name: `${project.name} — instance`,
      mcVersion: project.minecraft_version,
      loader,
      loaderVersion,
      path: result.instanceDir,
    }).catch(() => {});
    const status = await runtimeStatus(
      basePath,
      project.minecraft_version,
      loader,
      slug,
    ).catch(() => null);
    setRuntime(status);
    return result;
  };

  const handlePrepare = async () => {
    if (!basePath) return;
    setPhase("downloading");
    setProgress(null);
    try {
      const result = await ensureRuntime();
      if (!isVanilla) {
        const jar = await copyModJar(basePath, slug, `projects/${slug}`).catch(() => null);
        setModJar(jar);
      }
      const total = result.downloaded + result.skipped;
      toast.success("Minecraft is ready", {
        description:
          total > 0
            ? `Downloaded ${result.downloaded} official files (the cache is shared between projects).`
            : "Everything was already in the shared cache.",
      });
    } catch (error) {
      toast.error("Minecraft download failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPhase("idle");
    }
  };

  const handleLaunch = async () => {
    if (!basePath) return;
    if (!account) {
      toast.error("Sign in first", {
        description: "Settings → Launcher → Microsoft or Ely.by",
      });
      navigate("/settings/launcher");
      return;
    }
    // Ely.by needs a configured desktop client id to refresh tokens and to
    // launch with authlib-injector. Refuse early with a clear message.
    if (account.provider === "elyby" && !elyClientId.trim()) {
      toast.error("Ely.by client id not configured", {
        description:
          "Settings → Launcher → add the Ely.by desktop app client id (create one at account.ely.by/dev/applications/new).",
      });
      navigate("/settings/launcher");
      return;
    }
    setPhase("checking");
    try {
      const launchAccount = await getLaunchAccount();
      if (!launchAccount) {
        throw new Error("The selected account is no longer available. Sign in again.");
      }
      // The runtime is probed for real — a folder that exists is not a game
      // that starts. When something is missing, VOXEL downloads it now.
      const status = await runtimeStatus(
        basePath,
        project.minecraft_version,
        loader,
        slug,
      ).catch(() => null);
      if (!status?.ready) {
        setPhase("downloading");
        setProgress(null);
        await ensureRuntime();
      }
      if (!isVanilla) {
        const jar = await copyModJar(basePath, slug, `projects/${slug}`).catch(() => null);
        setModJar(jar);
      }

      await launchGame({
        basePath,
        projectSlug: slug,
        mcVersion: project.minecraft_version,
        loader,
        account: launchAccount,
        javaPath,
        ramMb,
        onLog: (line) => setGameLog((prev) => [...prev.slice(-40), line]),
        onExit: (success) => {
          runningRef.current = false;
          setPhase("idle");
          toast[success ? "info" : "error"](
            success ? "Minecraft exited" : "Minecraft crashed",
            { description: success ? "Hope the mod behaved!" : "Check the game log below." },
          );
        },
      });
      runningRef.current = true;
      setPhase("running");
      toast.success("Minecraft is starting", {
        description: `${project.loader} · ${project.minecraft_version} · ${ramMb / 1024} GB RAM`,
      });
    } catch (error) {
      toast.error("Launch failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (!runningRef.current) setPhase("idle");
    }
  };

  const handleStop = async () => {
    await stopGame(slug).catch(() => {});
    runningRef.current = false;
    setPhase("idle");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-4 w-4 text-primary" />
            Run {project.name}
          </DialogTitle>
          <DialogDescription>
            Isolated instance · Minecraft {project.minecraft_version} ·{" "}
            {isVanilla ? "Vanilla" : "Fabric"} — official Mojang files,
            downloaded locally at runtime.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <StatusRow
            ok={runtimeReady}
            pending={runtime === null}
            label="Minecraft runtime"
            okText="ready"
            pendingText="checking…"
            badText={
              runtime && runtime.missing.length > 0
                ? `missing: ${runtime.missing.join(", ")}`
                : "not downloaded yet"
            }
          />
          {isVanilla ? (
            <StatusRow
              ok
              pending={false}
              label="Content"
              okText="datapack — no mod jar needed"
              pendingText=""
              badText=""
            />
          ) : (
            <StatusRow
              ok={modJar !== null}
              pending={false}
              label="Mod jar"
              okText={modJar?.split("/").pop() ?? ""}
              pendingText=""
              badText="not built yet — the client still starts"
            />
          )}
          <StatusRow
            ok={account !== null}
            pending={false}
            label={`${accountProvider} account`}
            okText={account?.username ?? ""}
            pendingText=""
            badText="sign in via Settings → Launcher"
          />
        </div>

        {phase === "downloading" && (
          <div className="space-y-1.5 rounded-lg border border-primary/25 bg-primary/5 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
              <Download className="h-3 w-3" />
              Downloading official files… (first time only — shared cache)
            </p>
            {progress && progress.total > 0 && (
              <>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-brand-gradient transition-all"
                    style={{
                      width: `${Math.min(100, (progress.done / progress.total) * 100)}%`,
                    }}
                  />
                </div>
                <p className="truncate font-mono text-[9px] text-muted-foreground">
                  {progress.done}/{progress.total} — {progress.detail.slice(0, 60)}
                </p>
              </>
            )}
          </div>
        )}

        {phase === "running" && (
          <div className="space-y-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
              <ShieldCheck className="h-3 w-3" />
              Minecraft is running
              {isVanilla ? " — join your server from the Multiplayer list" : " with your mod installed"}
            </p>
            {gameLog.length > 0 && (
              <pre className="max-h-24 overflow-auto font-mono text-[9px] leading-relaxed text-muted-foreground">
                {gameLog.slice(-8).join("\n")}
              </pre>
            )}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || phase === "running" || runtimeReady}
            onClick={() => void handlePrepare()}
          >
            {phase === "downloading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {runtimeReady ? "Minecraft ready" : "Download Minecraft"}
          </Button>
          {phase === "running" ? (
            <Button variant="destructive" size="sm" onClick={() => void handleStop()}>
              <Square className="h-3.5 w-3.5" /> Stop game
            </Button>
          ) : (
            <Button
              variant="gradient"
              size="sm"
              disabled={busy || !account}
              onClick={() => void handleLaunch()}
            >
              <Play className="h-3.5 w-3.5" /> Launch Minecraft
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusRow({
  ok,
  pending,
  label,
  okText,
  pendingText,
  badText,
}: {
  ok: boolean;
  pending: boolean;
  label: string;
  okText: string;
  pendingText: string;
  badText: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            pending
              ? "animate-pulse-soft bg-muted-foreground/50"
              : ok
                ? "bg-emerald-400"
                : "bg-amber-400",
          )}
        />
        <span className="truncate font-mono text-[10px] text-foreground/80">
          {pending ? pendingText : ok ? okText : badText}
        </span>
      </span>
    </div>
  );
}
