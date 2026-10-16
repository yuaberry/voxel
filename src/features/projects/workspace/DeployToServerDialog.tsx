/**
 * DeployToServerDialog — the project↔server connection: copies the
 * project's datapack (structures, dimensions, advancements) into the
 * chosen server's world/datapacks/. Versions must match — the formats are
 * era-bound. Re-deploys of the same project replace atomically.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/stores/settingsStore";
import { listServers } from "@/services/db/repositories/serversRepository";
import { deployProjectDatapack } from "@/services/servers/projectDeployService";
import { EmptyState } from "@/components/EmptyState";
import type { ProjectRecord, ServerRecord } from "@/types";

interface Props {
  project: ProjectRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeployToServerDialog({ project, open, onOpenChange }: Props) {
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void listServers()
      .then((list) => {
        setServers(list);
        setTarget(list[0]?.slug ?? null);
      })
      .catch(() => setServers([]));
  }, [open]);

  // Era honesty: the datapack formats are version-bound — only same-version
  // servers deploy directly; others show as incompatible with the reason.
  const compatible = useMemo(
    () => servers.filter((s) => s.minecraft_version === project.minecraft_version),
    [servers, project.minecraft_version],
  );

  const deploy = async () => {
    if (!basePath || !target) return;
    setBusy(true);
    try {
      const result = await deployProjectDatapack(basePath, project.slug, target);
      const extras = [
        result.hasStructures ? "structures" : null,
        result.hasDimensions ? "dimensions" : null,
      ].filter(Boolean);
      toast.success(`Datapack deployed to ${target}`, {
        description: `${result.filesCopied} file(s) copied${extras.length ? ` (${extras.join(" + ")})` : ""} — restart the server (or /reload) to load it.`,
        duration: 10000,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error("Deploy failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Deploy to a server</DialogTitle>
          <DialogDescription>
            Copies this project's datapack (structures, dimensions,
            advancements — everything under{" "}
            <code className="text-foreground/80">data/</code>) into the
            server's <code className="text-foreground/80">world/datapacks/</code>,
            so your builds are live in-game. Same-version servers only: the
            formats are era-bound.
          </DialogDescription>
        </DialogHeader>

        {servers.length === 0 ? (
          <EmptyState
            icon="server"
            title="No servers yet"
            hint="Create a server first — the Servers tab has styled presets and community styles."
          />
        ) : compatible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
            You have {servers.length} server(s), but none on MC{" "}
            {project.minecraft_version}. Deploy needs a server of the same
            version — the datapack formats are era-bound.
          </p>
        ) : (
          <div className="grid gap-1.5">
            {compatible.map((server) => (
              <button
                key={server.slug}
                type="button"
                onClick={() => setTarget(server.slug)}
                className={
                  "flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-all active:scale-[0.98] " +
                  (target === server.slug
                    ? "border-primary/70 bg-primary/10"
                    : "border-border/70 hover:border-primary/40")
                }
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{server.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    MC {server.minecraft_version} · :{server.port}
                  </span>
                </span>
                {target === server.slug && <Badge variant="default">target</Badge>}
              </button>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="gradient"
            disabled={!target || busy || compatible.length === 0}
            onClick={() => void deploy()}
          >
            <Upload className="h-4 w-4" />
            {busy ? "Deploying…" : "Deploy datapack"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
