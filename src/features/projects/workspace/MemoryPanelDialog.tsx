import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { toast } from "sonner";
import { BookOpen, Loader2, Save, ShieldQuestion } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkContradictions,
  listMemory,
  saveMemory,
  type MemoryContradiction,
  type MemoryFile,
} from "@/services/projects/memoryService";
import type { ProjectRecord } from "@/types";

/**
 * Style Memory panel (§7): the project's bibles and decisions in one place —
 * editable, with the AI contradiction check. The memory is USER-OWNED:
 * AI suggestions never become permanent rules without a decision, so this
 * panel only reports; edits are yours.
 */
export function MemoryPanelDialog({
  project,
  open,
  onOpenChange,
  basePath,
}: {
  project: ProjectRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  basePath: string;
}) {
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [selected, setSelected] = useState<string>("style");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contradictions, setContradictions] = useState<MemoryContradiction[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setContradictions(null);
    listMemory(basePath, project.slug)
      .then((list) => {
        setFiles(list);
        const first = list.find((f) => f.content !== null) ?? list[0];
        setSelected(first?.id ?? "style");
        setDraft(first?.content ?? "");
        setDirty(false);
      })
      .catch(() => setFiles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.slug, basePath]);

  const current = files?.find((f) => f.id === selected) ?? null;

  const select = (file: MemoryFile) => {
    setSelected(file.id);
    setDraft(file.content ?? "");
    setDirty(false);
  };

  const save = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await saveMemory(basePath, project.slug, current.rel, draft);
      setFiles((prev) =>
        prev
          ? prev.map((f) => (f.id === current.id ? { ...f, content: draft } : f))
          : prev,
      );
      setDirty(false);
      toast.success(`${current.title} saved`, {
        description: "The agent reads this as design truth on its next run.",
      });
    } catch (error) {
      toast.error("Could not save", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    if (!files || busy) return;
    setBusy(true);
    setContradictions(null);
    try {
      const findings = await checkContradictions(files);
      setContradictions(findings);
      toast[findings.length === 0 ? "success" : "warning"](
        findings.length === 0 ? "No contradictions found" : `${findings.length} conflict${findings.length > 1 ? "s" : ""} found`,
        {
          description:
            findings.length === 0
              ? "The bibles agree with each other."
              : "Each finding quotes the conflicting passages — you decide what changes.",
          duration: 10000,
        },
      );
    } catch (error) {
      toast.error("Could not run the check", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[84vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            {t("Project memory")} — {project.name}
          </DialogTitle>
          <DialogDescription>
            {t(
              "The bibles and decisions the agent reads as design truth. Edit them freely — and let the AI check them for contradictions (every finding must quote the passages).",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {(files ?? []).map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => select(file)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                selected === file.id
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-primary/30",
                !file.content && "opacity-60",
              )}
            >
              {file.title}
              {!file.content ? <span className="ml-1 text-[9px]">(empty)</span> : null}
            </button>
          ))}
        </div>

        {current && (
          <>
            <p className="font-mono text-[10px] text-muted-foreground">{current.rel}</p>
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
              }}
              rows={10}
              className="w-full resize-y rounded-lg border border-input bg-background/60 px-3 py-2 font-mono text-[11px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="gradient" onClick={() => void save()} disabled={busy || !dirty}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {t("Save")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void runCheck()} disabled={busy || !files}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldQuestion className="h-3.5 w-3.5" />}
                {t("Check for contradictions (AI)")}
              </Button>
            </div>
          </>
        )}

        {contradictions !== null && (
          <div className="space-y-2">
            {contradictions.length === 0 ? (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                {t("No contradictions found")}.
              </p>
            ) : (
              contradictions.map((finding, i) => (
                <div key={i} className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-300">{finding.between}</p>
                  <p className="mt-1 text-[11px] italic leading-relaxed text-foreground/80">“{finding.quote}”</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{finding.why}</p>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
