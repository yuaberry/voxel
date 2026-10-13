import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Radar, Server as ServerIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CreateServerDialog, type CreateServerInitials } from "./CreateServerDialog";
import { ServerConsoleDialog } from "./ServerConsoleDialog";
import { ImportServerPanel } from "./ImportServerPanel";
import { useSettingsStore } from "@/stores/settingsStore";
import { listServers } from "@/services/db/repositories/serversRepository";
import { serverIsRunning } from "@/services/servers/serverService";
import { formatRelativeTime } from "@/lib/utils";
import type { ServerRecord } from "@/types";

export function ServersPage() {
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitials, setWizardInitials] = useState<CreateServerInitials | null>(null);
  const [consoleServer, setConsoleServer] = useState<ServerRecord | null>(null);
  const [runningSet, setRunningSet] = useState<Set<string>>(new Set());

  const basePath = useSettingsStore((s) => s.settings.storage.basePath);

  const refresh = useCallback(async () => {
    try {
      const list = await listServers();
      setServers(list);
      setLoaded(true);
      const running = new Set<string>();
      for (const server of list) {
        if (await serverIsRunning(server.slug).catch(() => false)) {
          running.add(server.slug);
        }
      }
      setRunningSet(running);
    } catch (error) {
      toast.error("Could not load servers", { description: String(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="flex items-center justify-between pb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-gradient">Server Studio</h1>
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
            Create server
          </Button>
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
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setConsoleServer(server)}
                    >
                      Console
                    </Button>
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
