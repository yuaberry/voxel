import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { projectGitDiff } from "@/services/projects/projectsService";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Changes panel — git diff of the working tree against the last snapshot,
 * rendered with added/removed line coloring. Refreshes after agent runs.
 */
export function ChangesView({
  projectSlug,
  refreshKey,
}: {
  projectSlug: string | null;
  refreshKey: number;
}) {
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!basePath || !projectSlug) return;
    setLoading(true);
    try {
      setDiff(await projectGitDiff(basePath, `projects/${projectSlug}`));
    } catch (error) {
      setDiff(`Could not read diff: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [basePath, projectSlug]);

  useEffect(() => {
    // microtask: refresh sets loading synchronously before its first await
    void Promise.resolve().then(() => refresh());
  }, [refresh, refreshKey]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Changes vs last snapshot
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => void refresh()}
          title="Refresh diff"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {diff === null ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
          </div>
        ) : diff.startsWith("No changes") || diff.trim().length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <p className="text-xs text-muted-foreground/70">
              Working tree is clean — matching the last snapshot.
            </p>
          </div>
        ) : (
          <pre className="p-3 font-mono text-[11px] leading-relaxed">
            {diff.split("\n").map((line, index) => {
              const isAdd = line.startsWith("+") && !line.startsWith("+++");
              const isRemove = line.startsWith("-") && !line.startsWith("---");
              const isHunk = line.startsWith("@@");
              const isMeta = line.startsWith("diff ") || line.startsWith("index ");
              return (
                <span
                  key={index}
                  className={
                    isAdd
                      ? "block bg-emerald-500/10 text-emerald-300"
                      : isRemove
                        ? "block bg-red-500/10 text-red-300"
                        : isHunk
                          ? "block bg-primary/10 text-primary"
                          : isMeta
                            ? "block text-muted-foreground/50"
                            : "block text-foreground/80"
                  }
                >
                  {line === "" ? " " : line}
                </span>
              );
            })}
          </pre>
        )}
      </div>
    </div>
  );
}
