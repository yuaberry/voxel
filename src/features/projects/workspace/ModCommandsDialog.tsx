import { useState } from "react";
import { t } from "@/i18n";
import { toast } from "sonner";
import { Loader2, MessageSquareCode, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CommandDraftEditor } from "@/components/CommandDraftEditor";
import {
  generateModCommandFiles,
  validateTriggerId,
  type CustomCommand,
} from "@/services/servers/customCommands";
import { writeProjectFile } from "@/services/projects/projectsService";
import type { ProjectRecord } from "@/types";

/**
 * Custom commands for the MOD itself — the owner's ask: "users make their
 * own commands for their server OR mods". The designer writes REAL
 * datapack files inside the project (src/main/resources/data/<modId>/),
 * the jar ships them, and the existing Deploy button carries them to any
 * server running the mod. Era-honest: pack format comes from the
 * project's template manifest (unchanged — the mod owns it).
 */
export function ModCommandsDialog({
  project,
  open,
  onOpenChange,
  basePath,
  packFormat,
}: {
  project: ProjectRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  basePath: string;
  packFormat: number;
}) {
  const [busy, setBusy] = useState(false);
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [draft, setDraft] = useState<CustomCommand | null>(null);
  const modId = project.slug.replace(/-/g, "_");

  const install = async () => {
    if (busy) return;
    if (commands.length === 0) {
      toast.warning("No commands yet", {
        description: "Design one — message, items, teleports, effects, mobs…",
      });
      return;
    }
    setBusy(true);
    try {
      const files = generateModCommandFiles(commands, modId, packFormat);
      for (const file of files) {
        await writeProjectFile(basePath, `projects/${project.slug}/${file.path}`, file.content);
      }
      toast.success(`Custom commands written into the mod (${commands.length})`, {
        description:
          "They ship inside the jar's datapack (data/minecraft tags + data/" +
          modId +
          "/ functions). Build and Deploy — players run /trigger <name> on any server with your mod.",
        duration: 12000,
      });
    } catch (error) {
      toast.error("Could not write the commands", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () => {
    if (!draft) return;
    const idError = validateTriggerId(draft.id);
    if (idError) {
      toast.warning(idError);
      return;
    }
    if (draft.actions.length === 0) {
      toast.warning("Add at least one action");
      return;
    }
    if (commands.some((c) => c.id === draft.id)) {
      toast.warning("There is already a command with that id");
      return;
    }
    setCommands((prev) => [...prev, draft]);
    setDraft(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareCode className="h-4 w-4 text-primary" />
            {t("Custom commands for this mod")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Design /trigger commands that ship INSIDE your mod — the jar carries them as a datapack, so every server running your mod gets them. Costs and /convert are server-economy features; here the commands are pure game logic.",
            )}
          </DialogDescription>
        </DialogHeader>

        {commands.length > 0 && (
          <div className="space-y-1.5">
            {commands.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold">
                    <code className="font-mono text-primary">/trigger {c.id}</code>
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {c.description} · {c.actions.length} action{c.actions.length > 1 ? "s" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  onClick={() => setCommands((prev) => prev.filter((x) => x.id !== c.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="gradient" onClick={() => void install()} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("Write into the mod datapack")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setDraft({ id: "", description: "", actions: [], cooldownSeconds: 0, costCoins: 0 })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            {t("Design a command")}
          </Button>
        </div>

        {draft && (
          <CommandDraftEditor
            draft={draft}
            onChange={setDraft}
            hasEconomy={false}
            onCancel={() => setDraft(null)}
            onSave={saveDraft}
            installHint={t(
              "Lands in src/main/resources/data/" +
                modId +
                "/functions — shipped by the jar, live with Build + Deploy.",
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
