import { useEffect, useState } from "react";
import { History, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createSnapshot,
  listSnapshots,
  projectGitStatus,
  restoreSnapshot,
} from "@/services/projects/projectsService";
import type { SnapshotEntry } from "@/types";

interface SnapshotPanelProps {
  basePath: string;
  projectRel: string;
  onAfterRestore: () => void;
}

export function SnapshotPanel({ basePath, projectRel, onAfterRestore }: SnapshotPanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [gitStatus, setGitStatus] = useState<string>("");
  const [confirmRestore, setConfirmRestore] = useState<SnapshotEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [list, status] = await Promise.all([
        listSnapshots(basePath, projectRel),
        projectGitStatus(basePath, projectRel).catch(() => ""),
      ]);
      setSnapshots(list);
      setGitStatus(status);
    } catch (error) {
      console.error("snapshot refresh failed", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // microtask: refresh settles loading synchronously on failure paths
    void Promise.resolve().then(() => refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, projectRel]);

  const dirtyCount = gitStatus ? gitStatus.split("\n").filter(Boolean).length : 0;

  const handleRestore = async () => {
    if (!confirmRestore) return;
    setBusy(true);
    try {
      await restoreSnapshot(basePath, projectRel, confirmRestore.sha);
      toast.success(`Restored snapshot ${confirmRestore.label}`, {
        description: "A restore commit was created — history is preserved.",
      });
      setConfirmRestore(null);
      onAfterRestore();
      await refresh();
    } catch (error) {
      toast.error("Restore failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          History
        </span>
        <Badge variant={dirtyCount > 0 ? "warning" : "success"}>
          {dirtyCount > 0 ? `${dirtyCount} changed` : "clean"}
        </Badge>
      </div>

      <div className="space-y-2 border-b border-border/60 p-3">
        <div className="flex gap-2">
          <Input
            placeholder="Snapshot reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-8 shrink-0"
            onClick={async () => {
              setBusy(true);
              try {
                const snapshot = await createSnapshot(
                  basePath,
                  projectRel,
                  reason.trim(),
                );
                toast.success(`Snapshot ${snapshot.label} created`);
                setReason("");
                await refresh();
              } catch (error) {
                toast.error("Snapshot failed", {
                  description: error instanceof Error ? error.message : String(error),
                });
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            Snapshot
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground/70">
          Snapshots are automatic git commits. Create one before risky changes —
          the AI Agent will do this for every generation.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && snapshots.length === 0 ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : snapshots.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <History className="mx-auto h-5 w-5 text-muted-foreground/40" />
            <p className="mt-2 text-[11px] text-muted-foreground/70">
              No snapshots yet — the initial scaffold commit exists in git.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {snapshots.map((snapshot) => (
              <button
                key={snapshot.sha}
                onClick={() => setConfirmRestore(snapshot)}
                className="group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border/60 hover:bg-accent/40"
              >
                <RotateCcw className="h-3 w-3 shrink-0 text-muted-foreground/50 group-hover:text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-foreground/90">
                    {snapshot.label}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground/70">
                    {snapshot.reason || snapshot.shortSha}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[9px] text-muted-foreground/50">
                  {snapshot.date.slice(0, 10)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={confirmRestore !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRestore(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Restore snapshot {confirmRestore?.label}?</DialogTitle>
            <DialogDescription>
              Tracked files return to the snapshot state and a restore commit is
              created first — nothing is lost from history. Files created after
              this snapshot stay in place (visible in the Changes tab).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRestore(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleRestore()}
              disabled={busy}
              variant="destructive"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Restore files
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
