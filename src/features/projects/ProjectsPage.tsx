import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { useNavigate } from "react-router-dom";
import { Boxes, FolderOpen, MoreVertical, Plus, Trash2, Clock, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProjectsStore } from "@/stores/projectsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { openInFileManager } from "@/services/storage/storageService";
import { deleteProjectFromDisk } from "@/services/projects/projectsService";
import { formatRelativeTime } from "@/lib/utils";
import type { ProjectRecord } from "@/types";

export function ProjectsPage() {
  const navigate = useNavigate();
  const projects = useProjectsStore((s) => s.projects);
  const loaded = useProjectsStore((s) => s.loaded);
  const hydrate = useProjectsStore((s) => s.hydrate);
  const removeProject = useProjectsStore((s) => s.removeProject);
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);

  const setWizardOpen = useUiStore((s) => s.setCreateWizardOpen);
  const [pendingDelete, setPendingDelete] = useState<ProjectRecord | null>(null);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!loaded) void hydrate();
  }, [loaded, hydrate]);

  const handlePermanentDelete = async () => {
    if (!pendingDelete || !basePath) return;
    if (confirmSlug !== pendingDelete.slug) return;
    setDeleting(true);
    try {
      await deleteProjectFromDisk(basePath, `projects/${pendingDelete.slug}`);
      await removeProject(pendingDelete.id);
      toast.success(`"${pendingDelete.name}" permanently deleted`);
      setPendingDelete(null);
      setConfirmSlug("");
    } catch (error) {
      toast.error("Delete failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleRemoveFromList = async (project: ProjectRecord) => {
    await removeProject(project.id);
    toast(`"${project.name}" removed from the list`, {
      description: "Files remain on disk — reopen by creating a project with the same folder.",
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="flex items-center justify-between pb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-gradient">{t("Projects")}</h1>
          <p className="text-sm text-muted-foreground">
            Real workspaces on disk — git-versioned, ready for the AI Creator.
          </p>
        </div>
        <Button variant="gradient" onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4" />
          Create project
        </Button>
      </div>

      {loaded && projects.length === 0 ? (
        <EmptyState onCreate={() => setWizardOpen(true)} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => navigate(`/projects/${project.id}`)}
              onReveal={() =>
                basePath &&
                void openInFileManager(project.path).catch((error) =>
                  toast.error(String(error)),
                )
              }
              onRemoveFromList={() => void handleRemoveFromList(project)}
              onPermanentDelete={() => {
                setConfirmSlug("");
                setPendingDelete(project);
              }}
            />
          ))}
        </div>
      )}

      {/* Permanent delete confirmation — typed slug, GitHub-style */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete project permanently?</DialogTitle>
            <DialogDescription>
              This removes{" "}
              <span className="font-mono text-foreground">
                {basePath ? `${basePath}/projects/` : ""}
                {pendingDelete?.slug}
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
              placeholder={pendingDelete?.slug}
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmSlug !== pendingDelete?.slug || deleting}
              onClick={() => void handlePermanentDelete()}
            >
              <Trash2 className="h-4 w-4" />
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onReveal,
  onRemoveFromList,
  onPermanentDelete,
}: {
  project: ProjectRecord;
  onOpen: () => void;
  onReveal: () => void;
  onRemoveFromList: () => void;
  onPermanentDelete: () => void;
}) {
  return (
    <Card className="group relative overflow-hidden transition-colors hover:border-primary/40">
      <div className="absolute right-0 top-0 h-20 w-20 translate-x-10 -translate-y-10 rounded-full bg-primary/10 blur-2xl transition-opacity group-hover:opacity-80" />
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={onOpen}
            className="min-w-0 flex-1 text-left"
            title="Open workspace"
          >
            <p className="truncate font-semibold">{project.name}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {project.description ?? "No description"}
            </p>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpen}>
                <FolderOpen className="h-3.5 w-3.5" /> Open workspace
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onReveal}>
                <FolderOpen className="h-3.5 w-3.5" /> Show in file manager
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRemoveFromList}>
                <Trash2 className="h-3.5 w-3.5" /> Remove from list
              </DropdownMenuItem>
              <DropdownMenuItem className="text-red-400" onClick={onPermanentDelete}>
                <Trash2 className="h-3.5 w-3.5" /> Delete permanently…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <Badge variant="default">{project.loader}</Badge>
          <Badge variant="secondary">MC {project.minecraft_version}</Badge>
          <Badge variant="outline">
            <FlaskConical className="h-3 w-3" /> {project.license}
          </Badge>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(project.updated_at)}
          </span>
          <Button size="sm" variant="secondary" onClick={onOpen}>
            Open
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border/80 px-6 py-16 text-center">
      <div className="rounded-xl bg-secondary/60 p-4">
        <Boxes className="h-8 w-8 text-muted-foreground/70" />
      </div>
      <div>
        <p className="font-semibold">No projects yet</p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          Create your first Fabric mod — a complete, compilable workspace with
          gradle wrapper, git snapshots and a starter item.
        </p>
      </div>
      <Button variant="gradient" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        Create project
      </Button>
    </div>
  );
}
