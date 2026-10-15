/**
 * DeleteProjectDialog — the typed-slug confirmation, reusable from the
 * projects list AND from inside the open project (the owner kept looking
 * for it there).
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { deleteProjectFromDisk } from "@/services/projects/projectsService";
import type { ProjectRecord } from "@/types";

interface Props {
  project: ProjectRecord | null;
  onClose: () => void;
  /** navigate away after the delete (used inside the workspace) */
  redirectTo?: string;
}

export function DeleteProjectDialog({ project, onClose, redirectTo }: Props) {
  const navigate = useNavigate();
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const removeProject = useProjectsStore((s) => s.removeProject);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!project || !basePath) return;
    if (confirmSlug !== project.slug) return;
    setDeleting(true);
    try {
      await deleteProjectFromDisk(basePath, `projects/${project.slug}`);
      await removeProject(project.id);
      toast.success(`"${project.name}" permanently deleted`);
      onClose();
      if (redirectTo) navigate(redirectTo);
    } catch (error) {
      toast.error("Could not delete the project", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDeleting(false);
      setConfirmSlug("");
    }
  };

  return (
    <Dialog
      open={project !== null}
      onOpenChange={(open) => {
        if (!open) {
          setConfirmSlug("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete project permanently?</DialogTitle>
          <DialogDescription>
            This removes{" "}
            <span className="font-mono text-foreground">
              {basePath ? `${basePath}/projects/` : ""}
              {project?.slug}
            </span>{" "}
            from disk, including the git history. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Type the project slug to confirm:
          </p>
          <input
            className="flex h-9 w-full rounded-md border border-input bg-background/60 px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder={project?.slug}
            value={confirmSlug}
            onChange={(e) => setConfirmSlug(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={confirmSlug !== project?.slug || deleting}
            onClick={() => void handleDelete()}
          >
            <Trash2 className="h-4 w-4" />
            {deleting ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
