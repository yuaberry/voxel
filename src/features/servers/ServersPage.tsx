import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { toast } from "sonner";
import { Loader2, Plus, Radar, Server as ServerIcon, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CreateServerDialog, type CreateServerInitials } from "./CreateServerDialog";
import { ServerConsoleDialog } from "./ServerConsoleDialog";
import { ServerCustomizeDialog } from "./ServerCustomizeDialog";
import { ImportServerPanel } from "./ImportServerPanel";
import { useSettingsStore } from "@/stores/settingsStore";
import { listServersReconciled } from "@/services/db/repositories/serversRepository";
import { DiagnosticsDialog } from "@/components/DiagnosticsDialog";
import { serverIsRunning } from "@/services/servers/serverService";
import { pingServer } from "@/services/servers/serverPingService";
import { PUBLIC_SERVER_REFS } from "@voxel/core/publicServers";
import { formatRelativeTime } from "@/lib/utils";
import type { ServerRecord } from "@/types";
import type { ServerPingData } from "@voxel/core/serverPing";

export function ServersPage() {
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitials, setWizardInitials] = useState<CreateServerInitials | null>(null);
  const [consoleServer, setConsoleServer] = useState<ServerRecord | null>(null);
  const [customizeServer, setCustomizeServer] = useState<ServerRecord | null>(null);
  const [runningSet, setRunningSet] = useState<Set<string>>(new Set());
  const [publicPings, setPublicPings] = useState<Record<string, ServerPingData | null>>({});

  const basePath = useSettingsStore((s) => s.settings.storage.basePath);

  const refresh = useCallback(async () => {
    try {
      if (!basePath) {
        setServers([]);
        setLoaded(true);
        return;
      }
      // The disk is the source of truth: folders without a db row are
      // adopted, ghost rows are retired — a server is never invisible
      // because a database write once failed.
      const list = await listServersReconciled(basePath);
      setServers(list);
      setLoaded(true);
      // parallel: one round-trip instead of server-count sequential awaits
      const states = await Promise.all(
        list.map((server) => serverIsRunning(server.slug).catch(() => false)),
      );
      setRunningSet(new Set(list.filter((_, i) => states[i]).map((server) => server.slug)));
    } catch (error) {
      toast.error("Could not load servers", { description: String(error) });
    }
  }, [basePath]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => void refresh(), 5000);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      // status polling pauses while the window is hidden — zero background cost
      if (document.hidden) stop();
      else {
        void refresh();
        start();
      }
    };
    void refresh();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // Community servers ping their real state — offline shows offline, never a lie.
  // Pings run in PARALLEL off the main thread (the Rust command is async),
  // and the whole loop PAUSES while the window is hidden — no background cost.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const pingAll = async () => {
      if (document.hidden) return; // paused — nothing runs in the background
      const settled = await Promise.allSettled(
        PUBLIC_SERVER_REFS.map((ref) => pingServer(ref.address)),
      );
      if (cancelled) return;
      const results: Record<string, ServerPingData | null> = {};
      PUBLIC_SERVER_REFS.forEach((ref, i) => {
        results[ref.id] =
          settled[i].status === "fulfilled"
            ? (settled[i] as PromiseFulfilledResult<ServerPingData>).value
            : null;
      });
      setPublicPings(results);
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      } else if (!timer) {
        void pingAll();
        timer = setInterval(() => void pingAll(), 45000);
      }
    };

    void pingAll();
    timer = setInterval(() => void pingAll(), 45000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="flex items-center justify-between pb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-gradient">{t("Server Studio")}</h1>
          <p className="text-sm text-muted-foreground">
            Local Minecraft servers — vanilla or Paper, real console, world-safe
            stop, timestamped backups.
          </p>
        </div>
        <Button variant="gradient" onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4" />
          Create server
        </Button>
      </div>

      {loaded && servers.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border/80 px-6 py-16 text-center">
          <div className="rounded-xl bg-secondary/60 p-4">
            <ServerIcon className="h-8 w-8 text-muted-foreground/70" />
          </div>
          <div>
            <p className="font-semibold">No servers yet</p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Spin up a styled server in seconds — presets below, or import the
              vibe of any live server with a real ping.
            </p>
          </div>
          <Button variant="gradient" onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("Create server")}
          </Button>
          <DiagnosticsDialog
            basePath={basePath}
            trigger={
              <Button variant="outline" size="sm">
                <Stethoscope className="h-3.5 w-3.5" />
                {t("Something not working? Run diagnostics")}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => {
            const running = runningSet.has(server.slug);
            return (
              <Card
                key={server.id}
                className="relative overflow-hidden transition-colors hover:border-primary/40"
              >
                <div className="absolute right-0 top-0 h-16 w-16 translate-x-8 -translate-y-8 rounded-full bg-primary/10 blur-2xl" />
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setConsoleServer(server)}
                      title="Open console"
                    >
                      <p className="truncate font-semibold">{server.name}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        :{server.port} · {server.ram_mb / 1024} GB
                      </p>
                    </button>
                    <span
                      className={
                        "mt-1 h-2.5 w-2.5 shrink-0 rounded-full " +
                        (running
                          ? "animate-pulse-soft bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                          : "bg-muted-foreground/40")
                      }
                      title={running ? "online" : "offline"}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge variant="default">{server.software}</Badge>
                    <Badge variant="secondary">MC {server.minecraft_version}</Badge>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground/70">
                      {formatRelativeTime(server.updated_at)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCustomizeServer(server)}
                      >
                        Customize
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setConsoleServer(server)}
                      >
                        Console
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Import & references — real SLP pings, live styles */}
      <section className="pb-2">
        <h2 className="flex items-center gap-2 pb-3 text-lg font-bold tracking-tight">
          <Radar className="h-4 w-4 text-primary" />
          Import & references
        </h2>
        <ImportServerPanel
          onApplyPreset={(preset, name, properties) => {
            setWizardInitials({ preset, name, properties });
            setWizardOpen(true);
          }}
        />
      </section>

      {/* -------- Community servers, live -------- */}
      <section className="mt-10">
        <div className="mb-3 flex items-center gap-2">
          <Radar className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">{t("Community servers — live")}</h2>
          <span className="text-[11px] text-muted-foreground">
            real SLP pings every 45s · import any style below
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PUBLIC_SERVER_REFS.map((ref) => {
            const ping = publicPings[ref.id];
            const online = ping !== null;
            return (
              <Card
                key={ref.id}
                className="animate-card-rise border-border/70 bg-card/60 transition-colors hover:border-primary/40"
              >
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{ref.name}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {ref.address}
                      </p>
                    </div>
                    <span
                      className={
                        "mt-1 h-2.5 w-2.5 shrink-0 rounded-full " +
                        (online
                          ? "animate-pulse-soft bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                          : "bg-muted-foreground/40")
                      }
                      title={online ? "online" : "offline"}
                    />
                  </div>
                  {online && ping ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary">{ping.playersOnline} online</Badge>
                      <Badge variant="outline">{ping.version.split(" ")[0]}</Badge>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground/70">offline right now</p>
                  )}
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    {ref.note}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    onClick={() =>
                      setWizardInitials({
                        preset: null,
                        name: ref.name + " (my version)",
                        properties: {},
                        importedAddress: ref.address,
                      })
                    }
                    title="Create a local server in this style"
                  >
                    Use this style
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <CreateServerDialog
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) {
            setWizardInitials(null);
            void refresh();
          }
        }}
        initials={wizardInitials}
      />

      {customizeServer ? (
        <ServerCustomizeDialog
          server={customizeServer}
          open={Boolean(customizeServer)}
          onOpenChange={(next) => {
            if (!next) setCustomizeServer(null);
          }}
          basePath={basePath}
        />
      ) : null}
      <ServerConsoleDialog
        server={consoleServer}
        basePath={basePath}
        onClose={() => {
          setConsoleServer(null);
          void refresh();
        }}
      />

      {loaded && servers.length === 0 && (
        <p className="mt-8 text-center text-[11px] text-muted-foreground/50">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
          status refreshes every 5 seconds
        </p>
      )}
    </div>
  );
}
