import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Github, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ProjectRecord } from "@/types";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  commitAll,
  createGithubRepo,
  getGithubToken,
  getGithubUser,
  pushToGithub,
  recordGithubRepository,
  type GithubUser,
} from "@/services/github/githubService";

interface Props {
  project: ProjectRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Publish flow: commit pending changes → create the GitHub repository →
 * push with a transient auth header. Nothing sensitive is persisted.
 */
export function PublishDialog({ project, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);

  const [user, setUser] = useState<GithubUser | null>(null);
  const [repoName, setRepoName] = useState(project.slug);
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // open-reset runs off the synchronous effect path
    void Promise.resolve().then(() => {
      setRepoName(project.slug);
      setPublishedUrl(null);
    });
    void getGithubToken().then(async (token) => {
      if (!token) {
        setUser(null);
        return;
      }
      try {
        setUser(await getGithubUser(token));
      } catch {
        setUser(null);
      }
    });
  }, [open, project.slug]);

  const handlePublish = useCallback(async () => {
    if (!basePath || !user) return;
    setBusy(true);
    try {
      // 1. Commit everything pending (AD-7 keeps history; nothing is lost)
      const commit = await commitAll(
        basePath,
        `projects/${project.slug}`,
        `Publish ${project.name} via VOXEL`,
      );
      if (commit !== "Nothing to commit — working tree is clean") {
        toast.success(`Committed ${commit}`);
      }

      // 2. Create the repository
      const repo = await createGithubRepo({
        name: repoName,
        description: project.description ?? `${project.name} — built with VOXEL`,
        private: isPrivate,
      });

      // 3. Push
      const push = await pushToGithub({
        basePath,
        projectRel: `projects/${project.slug}`,
        remoteUrl: `${repo.cloneUrl}.git`,
      });

      await recordGithubRepository({
        projectId: project.id,
        owner: repo.fullName.split("/")[0] ?? user.login,
        name: repoName,
        url: repo.htmlUrl,
        branch: push.branch,
      });

      setPublishedUrl(repo.htmlUrl);
      toast.success("Published to GitHub", {
        description: `${repo.fullName} · branch ${push.branch}`,
      });
    } catch (error) {
      toast.error("Publish failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [basePath, user, project, repoName, isPrivate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-4 w-4" />
            Publish {project.name}
          </DialogTitle>
          <DialogDescription>
            Commit, create the repository and push — full project history on
            GitHub, token never persisted in the repo.
          </DialogDescription>
        </DialogHeader>

        {publishedUrl ? (
          <div className="space-y-3 text-center">
            <Check className="mx-auto h-8 w-8 text-emerald-400" />
            <p className="text-sm font-medium">Project published</p>
            <p className="font-mono text-xs text-primary">{publishedUrl}</p>
            <Badge variant="secondary">pushed · {isPrivate ? "private" : "public"}</Badge>
          </div>
        ) : user ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-3 py-2">
              <span className="text-xs text-muted-foreground">Account</span>
              <Badge variant="success">{user.login}</Badge>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repo-name">Repository name</Label>
              <Input
                id="repo-name"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-3 py-2">
              <span className="text-xs text-muted-foreground">Private repository</span>
              <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground/70">
              Publishing commits everything pending first (your snapshot history
              stays intact) and pushes the current branch with a transient
              auth header.
            </p>
          </div>
        ) : (
          <div className="space-y-2 text-center">
            <p className="text-sm text-muted-foreground">
              Sign in to GitHub first (Settings → GitHub).
            </p>
            <Button variant="secondary" size="sm" onClick={() => navigate("/settings/github")}>
              Open GitHub settings
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
          {!publishedUrl && (
            <Button
              variant="gradient"
              disabled={busy || !user || repoName.trim().length < 2}
              onClick={() => void handlePublish()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {busy ? "Publishing…" : "Commit & publish"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
