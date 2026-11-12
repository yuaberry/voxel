/**
 * Multiplayer list — the servers the client shows on its Multiplayer
 * screen.
 *
 * The list is the REAL vanilla file (`servers.dat`) written into the game
 * directory of an instance: the local servers of this workspace (through
 * the loopback, on the port they really listen on) plus the public
 * references the owner picks. The panel reports what actually landed in
 * the file — the resolved address, the port and whether it came from the
 * SRV record.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { List, Loader2, Radio, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settingsStore";
import { listServersReconciled } from "@/services/db/repositories/serversRepository";
import {
  buildMultiplayerEntries,
  writeServerListToAllInstances,
  type MultiplayerServerEntry,
  type MultiplayerSyncResult,
} from "@/services/servers/multiplayerService";
import { PUBLIC_SERVER_REFS } from "@voxel/core/publicServers";
import type { ServerRecord } from "@/types";

export interface MultiplayerListPanelProps {
  /** the prepared instances — the owner picks where the list lands */
  instances: { slug: string }[];
}

export function MultiplayerListPanel({ instances }: MultiplayerListPanelProps) {
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const updateSettings = useSettingsStore((s) => s.update);
  // the enabled references live in the settings — the list the game shows
  // must be the same in every instance and after every restart
  const publicServerIds = useSettingsStore(
    (s) => s.settings.launcher.publicServerIds ?? [],
  );
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MultiplayerSyncResult | null>(null);

  useEffect(() => {
    if (!basePath) return;
    let cancelled = false;
    void listServersReconciled(basePath)
      .then((list) => {
        if (!cancelled) setServers(list);
      })
      .catch(() => {
        // the disk scan can fail on a locked workspace — the list stays empty
        // and the owner still sees the references
        if (!cancelled) setServers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [basePath]);

  const references = useMemo(
    () => PUBLIC_SERVER_REFS.filter((ref) => publicServerIds.includes(ref.id)),
    [publicServerIds],
  );

  const entries: MultiplayerServerEntry[] = useMemo(
    () => buildMultiplayerEntries(servers, references),
    [servers, references],
  );

  const toggleReference = useCallback(
    (id: string, checked: boolean) => {
      const next = checked
        ? [...publicServerIds, id]
        : publicServerIds.filter((current) => current !== id);
      void updateSettings("launcher", { publicServerIds: next }).catch(() => {});
    },
    [publicServerIds, updateSettings],
  );

  const write = useCallback(async () => {
    if (!basePath || instances.length === 0) return;
    setBusy(true);
    try {
      // EVERY instance gets the list — the file lives in the game
      // directory of the instance, so a list written into one of them is
      // invisible to the others.
      const written = await writeServerListToAllInstances(
        basePath,
        instances.map((item) => item.slug),
        entries,
      );
      setResult(written);
      if (written.failed.length > 0) {
        toast.error("Some instances could not receive the list", {
          description: written.failed
            .map((failure) => `${failure.slug}: ${failure.error}`)
            .join(" · "),
        });
        return;
      }
      toast.success("Multiplayer list written", {
        description: `${entries.length} server(s) in ${written.written.length} instance(s)`,
      });
    } catch (error) {
      toast.error("Could not write the multiplayer list", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [basePath, instances, entries]);

  if (instances.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <List className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Multiplayer list</h2>
        <span className="text-[11px] text-muted-foreground">
          the servers your client shows on the Multiplayer screen
        </span>
      </div>

      <Card className="border-border/70 bg-card/60">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <p className="mb-1.5 text-[11px] text-muted-foreground">
                Instances receiving the list
              </p>
              <div className="flex flex-wrap gap-1.5">
                {instances.map((item) => (
                  <Badge key={item.slug} variant="outline" className="font-mono text-[10px]">
                    {item.slug}
                  </Badge>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                the list lives in the game folder of each instance — every
                project you launch shows the same servers
              </p>
            </div>
            <Button
              variant="gradient"
              onClick={() => void write()}
              disabled={busy || entries.length === 0}
              title="Writes the list into every instance of this workspace"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Write servers.dat
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                Your servers
              </p>
              {servers.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/70">
                  No local server yet — create one in Server Studio.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {servers.map((server) => (
                    <li
                      key={server.slug}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5"
                    >
                      <span className="truncate text-xs">{server.name}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        127.0.0.1:{server.port}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                Public references
              </p>
              <ul className="space-y-1.5">
                {PUBLIC_SERVER_REFS.map((ref) => (
                  <li
                    key={ref.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 truncate text-xs">{ref.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                        {ref.address}
                      </span>
                      <Switch
                        checked={publicServerIds.includes(ref.id)}
                        onCheckedChange={(checked) => toggleReference(ref.id, checked)}
                        aria-label={`Include ${ref.name}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {result ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                <Radio className="h-3 w-3" />
                {entries.length} server(s) written to {result.written.length}{" "}
                instance(s)
                {result.failed.length > 0
                  ? ` · ${result.failed.length} failed`
                  : ""}
              </p>
              <ul className="mt-2 space-y-1">
                {result.written.map((item) => (
                  <li
                    key={item.slug}
                    className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                  >
                    <span className="truncate">{item.slug}</span>
                    <span className="font-mono">{item.servers} server(s)</span>
                  </li>
                ))}
                {result.failed.map((item) => (
                  <li
                    key={`failed-${item.slug}`}
                    className="flex items-center justify-between gap-2 text-[11px] text-red-400"
                  >
                    <span className="truncate">{item.slug}</span>
                    <span className="truncate font-mono">{item.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
