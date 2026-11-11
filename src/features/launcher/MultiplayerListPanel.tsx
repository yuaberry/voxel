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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settingsStore";
import { listServersReconciled } from "@/services/db/repositories/serversRepository";
import {
  buildMultiplayerEntries,
  writeInstanceServerList,
  type MultiplayerServerEntry,
  type ServersDatResult,
} from "@/services/servers/multiplayerService";
import { PUBLIC_SERVER_REFS } from "@voxel/core/publicServers";
import type { ServerRecord } from "@/types";

export interface MultiplayerListPanelProps {
  /** the prepared instances — the owner picks where the list lands */
  instances: { slug: string }[];
}

export function MultiplayerListPanel({ instances }: MultiplayerListPanelProps) {
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [instance, setInstance] = useState<string>("");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    nerdzone: true,
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ServersDatResult | null>(null);

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

  // the first instance is the default target — the owner can pick another
  const selected = instance || instances[0]?.slug || "";

  const references = useMemo(
    () => PUBLIC_SERVER_REFS.filter((ref) => enabled[ref.id]),
    [enabled],
  );

  const entries: MultiplayerServerEntry[] = useMemo(
    () => buildMultiplayerEntries(servers, references),
    [servers, references],
  );

  const write = useCallback(async () => {
    if (!basePath || !selected) return;
    setBusy(true);
    try {
      const written = await writeInstanceServerList(basePath, selected, entries);
      setResult(written);
      toast.success("Multiplayer list written", {
        description: `${written.written} server(s) in ${selected}/servers.dat`,
      });
    } catch (error) {
      toast.error("Could not write the multiplayer list", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [basePath, selected, entries]);

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
              <p className="mb-1.5 text-[11px] text-muted-foreground">Instance</p>
              <Select value={selected} onValueChange={setInstance}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick an instance" />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((item) => (
                    <SelectItem key={item.slug} value={item.slug}>
                      {item.slug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="gradient"
              onClick={() => void write()}
              disabled={busy || !selected || entries.length === 0}
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
                        checked={Boolean(enabled[ref.id])}
                        onCheckedChange={(checked) =>
                          setEnabled((current) => ({
                            ...current,
                            [ref.id]: checked,
                          }))
                        }
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
                {result.written} server(s) written to {result.path}
              </p>
              <ul className="mt-2 space-y-1">
                {result.entries.map((entry) => (
                  <li
                    key={`${entry.name}-${entry.address}`}
                    className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                  >
                    <span className="truncate">{entry.name}</span>
                    <span className="font-mono">
                      {entry.address}:{entry.port}
                      {entry.srv ? " · SRV" : ""}
                    </span>
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
