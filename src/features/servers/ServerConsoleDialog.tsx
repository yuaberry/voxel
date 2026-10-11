import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  FileCog,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ServerEconomyPanel } from "./ServerEconomyPanel";
import { pingServer } from "@/services/servers/serverPingService";
import { parseMotd } from "@voxel/core/motd";
import type { ServerPingData } from "@voxel/core/serverPing";
import {
  backupServer,
  listServerBackups,
  restoreServerBackup,
  sendServerCommand,
  startServer,
  stopServer,
  subscribeServerConsole,
} from "@/services/servers/serverService";
import {
  readProjectFile,
  writeProjectFile,
} from "@/services/projects/projectsService";
import { removeServer, updateServerStatus } from "@/services/db/repositories/serversRepository";
import { useSettingsStore } from "@/stores/settingsStore";
import { detectEnvironment } from "@/services/environment/environmentService";
import type { ServerBackupInfo, ServerRecord } from "@/types";

interface Props {
  server: ServerRecord | null;
  basePath: string;
  onClose: () => void;
}

/**
 * Server console — live log, stdin commands, world-safe stop, backups and
 * a properties editor (plain text, saved with one click).
 */
export function ServerConsoleDialog({ server, basePath, onClose }: Props) {
  const [log, setLog] = useState<Array<{ stream: string; line: string }>>([]);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [livePing, setLivePing] = useState<ServerPingData | null>(null);
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<ServerBackupInfo[]>([]);
  const [properties, setProperties] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<ServerBackupInfo | null>(null);
  const [tab, setTab] = useState<"console" | "economy">("console");
  const logRef = useRef<HTMLDivElement>(null);
  const customJava = useSettingsStore((s) => s.settings.java.customJavaPath);

  const slug = server?.slug ?? "";
  const open = server !== null;

  const refreshBackups = useCallback(async () => {
    if (!basePath || !slug) return;
    setBackups(await listServerBackups(basePath, slug).catch(() => []));
  }, [basePath, slug]);

  useEffect(() => {
    if (!open || !slug) return;
    let unlisteners: Array<() => void> = [];

    void (async () => {
      unlisteners = await subscribeServerConsole(slug, {
        onLog: (stream, line) =>
          setLog((prev) => (prev.length > 400 ? [...prev.slice(-400), { stream, line }] : [...prev, { stream, line }])),
        onExit: (success) => {
          setRunning(false);
          void updateServerStatus(slug, "stopped");
          toast[success ? "info" : "warning"](
            success ? "Server stopped" : "Server exited with an error",
          );
        },
      });
    })();

    return () => {
      for (const fn of unlisteners) fn();
    };
  }, [open, slug]);

  useEffect(() => {
    if (open) {
      setLog([]);
      void refreshBackups();
      void import("@/services/servers/serverService").then((m) => {
        void m.serverIsRunning(slug).then(setRunning).catch(() => setRunning(false));
      });
    }
  }, [open, slug, refreshBackups]);

  // Live preview — real SLP self-ping while the server runs (the same
  // protocol any server list uses): MOTD, version and player count as
  // players actually see them.
  useEffect(() => {
    if (!open || !running || !server) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const ping = await pingServer(`127.0.0.1:${server.port}`);
        if (!cancelled) setLivePing(ping);
      } catch {
        if (!cancelled) setLivePing(null); // booting or behind a proxy — console is truth
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, running, server]);

  useEffect(() => {
    if (!running) setLivePing(null);
  }, [running]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const handleStart = async () => {
    if (!server || !basePath) return;
    setBusy(true);
    try {
      await startServer(basePath, slug, server.ram_mb, customJava);
      setRunning(true);
      await updateServerStatus(slug, "running");
      toast.success("Server starting", {
        description: "First boot generates the world — watch the console.",
      });
      // Honest compatibility note: 1.20.x targets Java 17 officially
      const env = await detectEnvironment().catch(() => null);
      if (
        env?.java.majorVersion &&
        env.java.majorVersion >= 21 &&
        server.minecraft_version.startsWith("1.20")
      ) {
        toast.warning("Heads up: Java 21 with MC 1.20.x", {
          description:
            "1.20.x officially targets Java 17 — shutdown may hang on Java 21. If \"stop\" takes over 30s, VOXEL force-stops it automatically. A Java 17 path can be set in Settings → Java.",
          duration: 9000,
        });
      }
    } catch (error) {
      toast.error("Could not start server", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopServer(slug);
      toast.info("Stop signal sent", {
        description: "The server saves the world and exits cleanly.",
      });
    } catch (error) {
      toast.error("Could not stop server", { description: String(error) });
    }
  };

  const handleCommand = async () => {
    const line = command.trim();
    if (!line) return;
    setCommand("");
    try {
      await sendServerCommand(slug, line);
      setLog((prev) => [...prev, { stream: "local", line: `> ${line}` }]);
    } catch (error) {
      toast.error("Command failed", { description: String(error) });
    }
  };

  const handleBackup = async () => {
    if (!basePath) return;
    setBusy(true);
    try {
      const backup = await backupServer(basePath, slug);
      await import("@/services/db/repositories/serversRepository").then((m) =>
        m.recordBackup({ id: backup.id, slug, path: backup.path, sizeBytes: backup.sizeBytes }),
      );
      toast.success("Backup created", { description: backup.fileName });
      await refreshBackups();
    } catch (error) {
      toast.error("Backup failed", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!confirmRestore || !basePath) return;
    setBusy(true);
    try {
      await restoreServerBackup(basePath, slug, confirmRestore.path);
      toast.success("Backup restored", { description: confirmRestore.fileName });
      setConfirmRestore(null);
    } catch (error) {
      toast.error("Restore failed", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!server || !basePath) return;
    if (running) {
      toast.error("Stop the server before deleting");
      return;
    }
    try {
      await import("@/services/servers/serverService").then((m) =>
        m.deleteServer(basePath, slug),
      );
      await removeServer(slug);
      toast.success(`Server "${server.name}" deleted`);
      onClose();
    } catch (error) {
      toast.error("Delete failed", { description: String(error) });
    }
  };

  const loadProperties = async () => {
    if (!basePath) return;
    const content = await readProjectFile(
      basePath,
      `servers/${slug}/server.properties`,
    ).catch(() => null);
    setProperties(content ?? "# server.properties not found");
  };

  const saveProperties = async () => {
    if (!basePath || properties === null) return;
    try {
      await writeProjectFile(basePath, `servers/${slug}/server.properties`, properties);
      toast.success("server.properties saved — restart to apply");
    } catch (error) {
      toast.error("Could not save properties", { description: String(error) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="flex h-[80vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            {server?.name}
            <Badge variant={running ? "success" : "secondary"}>
              {running ? "online" : "offline"}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {server?.software} · MC {server?.minecraft_version} · port {server?.port}
          </DialogDescription>
          {livePing && (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-card/60 px-3 py-2">
              <span className="font-mono text-[11px] leading-relaxed">
                {parseMotd(
                  livePing.motdRaw.startsWith("{")
                    ? (JSON.parse(livePing.motdRaw) as unknown)
                    : livePing.motdRaw,
                ).map((part, index) => (
                  <span
                    key={index}
                    style={{
                      color: part.color,
                      fontWeight: part.bold ? 700 : 400,
                      fontStyle: part.italic ? "italic" : undefined,
                      textDecoration:
                        [part.underline ? "underline" : "", part.strikethrough ? "line-through" : ""]
                          .filter(Boolean)
                          .join(" ") || undefined,
                    }}
                  >
                    {part.text}
                  </span>
                ))}
              </span>
              <Badge variant="success" className="ml-auto">
                {livePing.playersOnline}/{livePing.playersMax} playing now
              </Badge>
            </div>
          )}
        </DialogHeader>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button variant="destructive" size="sm" onClick={() => void handleStop()}>
              <Square className="h-3.5 w-3.5" /> Stop (world-safe)
            </Button>
          ) : (
            <Button
              variant="gradient"
              size="sm"
              onClick={() => void handleStart()}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Start
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void handleBackup()} disabled={busy || running}>
            <Archive className="h-3.5 w-3.5" /> Backup
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (properties === null ? void loadProperties() : setProperties(null))}
          >
            <FileCog className="h-3.5 w-3.5" />
            {properties === null ? "Properties" : "Hide properties"}
          </Button>
          <span className="ml-auto" />
          <Button variant="ghost" size="sm" onClick={() => void handleDelete()} title="Delete server and world">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Console / Economy tabs */}
        <div className="flex items-center gap-1 border-b border-border/40 pb-1">
          <button
            className={"rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors " + (tab === "console" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setTab("console")}
          >
            <Terminal className="mr-1 inline h-3 w-3" /> Console
          </button>
          <button
            className={"rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors " + (tab === "economy" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setTab("economy")}
          >
            Economy & Public
          </button>
        </div>

        {/* Properties editor */}
        {properties !== null && (
          <div className="space-y-2 rounded-lg border border-border/70 bg-card/50 p-3">
            <textarea
              className="h-40 w-full resize-none rounded-md border border-input bg-background/70 p-2 font-mono text-[11px] outline-none focus:ring-2 focus:ring-ring"
              value={properties}
              onChange={(e) => setProperties(e.target.value)}
              spellCheck={false}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setProperties(null)}>
                Close
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void saveProperties()}>
                Save
              </Button>
            </div>
          </div>
        )}

        {/* Console */}
        <div
          ref={logRef}
          className={"min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/60 bg-background/70 p-3 font-mono text-[11px] leading-relaxed " + (tab === "console" ? "" : "hidden")}
        >
          {log.length === 0 ? (
            <p className="text-muted-foreground/50">
              Console is quiet — start the server to see its output here.
            </p>
          ) : (
            log.map((entry, index) => (
              <div
                key={index}
                className={
                  entry.stream === "stderr"
                    ? "text-red-300/90"
                    : entry.stream === "local"
                      ? "text-primary"
                      : "text-foreground/80"
                }
              >
                {entry.line}
              </div>
            ))
          )}
        </div>

        {/* Economy & Public */}
        {tab === "economy" && server && (
          <div className="max-h-[50%] overflow-y-auto rounded-lg border border-border/60 bg-background/70 p-3">
            <ServerEconomyPanel server={server} basePath={basePath} />
          </div>
        )}

        {/* Command input */}
        <div className="flex gap-2">
          <Input
            placeholder="say Hello adventurers!"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCommand();
            }}
            disabled={!running}
            className="font-mono text-xs"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleCommand()}
            disabled={!running || !command.trim()}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Backups */}
        <Separator />
        <div className="max-h-24 space-y-1.5 overflow-y-auto">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <RotateCcw className="h-3 w-3" /> Backups
          </p>
          {backups.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/60">
              No backups yet — stop the server and press Backup.
            </p>
          ) : (
            backups.map((backup) => (
              <div key={backup.id} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {backup.fileName} · {(backup.sizeBytes / 1024 / 1024).toFixed(1)} MB
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px]"
                  disabled={running}
                  onClick={() => setConfirmRestore(backup)}
                >
                  Restore
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Restore confirmation */}
        <Dialog open={confirmRestore !== null} onOpenChange={(next) => { if (!next) setConfirmRestore(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Restore this backup?</DialogTitle>
              <DialogDescription>
                The current world and configs are replaced by{" "}
                <span className="font-mono">{confirmRestore?.fileName}</span>.
                Create a fresh backup first if the current state matters.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmRestore(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleRestore()}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Restore
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
