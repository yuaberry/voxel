import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCw, ShieldAlert, ShieldQuestion, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjectsStore } from "@/stores/projectsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  checkProjectCompatibility,
  buildCompatibilityMatrix,
  type ProjectCompat,
  type MatrixCell,
} from "@/services/compat/compatService";
import { getVersions } from "@/services/minecraft/versionCatalog";
import { cn } from "@/lib/utils";

const VERDICT_META = {
  compatible: { icon: CheckCircle2, className: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" },
  warning: { icon: TriangleAlert, className: "border-amber-500/40 bg-amber-500/5 text-amber-400" },
  incompatible: { icon: ShieldAlert, className: "border-red-500/40 bg-red-500/5 text-red-400" },
  unknown: { icon: ShieldQuestion, className: "border-border/60 bg-card/50 text-muted-foreground" },
} as const;

/**
 * Compatibility Lab (§12): every verdict with its justification and
 * evidence — loader×version from the catalog's era schemas, the Java the
 * template needs vs the machine's, the era/mappings honesty, and the real
 * gradle.properties facts.
 */
export function CompatibilityPage() {
  const projects = useProjectsStore((s) => s.projects);
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const [projectId, setProjectId] = useState("");
  const [result, setResult] = useState<ProjectCompat | null>(null);
  const [busy, setBusy] = useState(false);
  const [matrix, setMatrix] = useState<MatrixCell[] | null>(null);

  const project = projects.find((p) => p.id === projectId) ?? null;

  const run = useCallback(async () => {
    if (!basePath || !project) return;
    setBusy(true);
    try {
      setResult(await checkProjectCompatibility(basePath, project));
    } catch (error) {
      toast.error("Could not check compatibility", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [basePath, project]);

  const loadMatrix = useCallback(async () => {
    try {
      const versions = (await getVersions()).filter((v) => v.kind === "release").slice(0, 14);
      const cells = await buildCompatibilityMatrix(versions, ["fabric", "forge", "neoforge"]);
      setMatrix(cells);
    } catch {
      setMatrix(null);
    }
  }, []);

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projects, projectId]);

  useEffect(() => {
    void loadMatrix();
  }, [loadMatrix]);

  useEffect(() => {
    if (project) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="bg-gradient-to-r from-brand-purple to-brand-cyan bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
            {t("Compatibility Lab")}
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t(
              "Every verdict with its evidence: loader × version (the catalog's eras), the Java this era needs versus this machine, the mappings honesty, and the real gradle.properties facts.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {projects.length > 0 ? (
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-60">
                <SelectValue placeholder={t("Project")} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.loader} {p.minecraft_version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline">{t("Create a project first")}</Badge>
          )}
          <Button size="sm" variant="outline" onClick={() => void run()} disabled={busy || !project}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("Recheck")}
          </Button>
        </div>
      </div>

      {result && (
        <div className="mt-5 flex flex-wrap gap-2">
          {(["compatible", "warning", "incompatible", "unknown"] as const).map((kind) => (
            <Badge
              key={kind}
              variant="outline"
              className={cn("text-[10px]", VERDICT_META[kind].className)}
            >
              {result.summary[kind]} {kind}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-2.5">
        {busy && !result ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("Reading the real facts…")}
          </div>
        ) : null}
        {result?.checks.map((check) => {
          const meta = VERDICT_META[check.verdict];
          return (
            <div key={check.id} className={cn("rounded-xl border px-4 py-3", meta.className)}>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <meta.icon className="h-4 w-4 shrink-0" />
                {check.title}
                <Badge variant="outline" className="ml-auto text-[9px] uppercase">{check.verdict}</Badge>
              </p>
              <p className="mt-1.5 pl-6 text-xs leading-relaxed text-foreground/80">{check.evidence}</p>
              {check.fix && (
                <p className="mt-1 pl-6 text-xs text-foreground">
                  <span className="font-semibold">{t("Fix")}: </span>
                  {check.fix}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {matrix && matrix.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold">{t("Version × loader matrix (from the catalog)")}</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border/60">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/60 bg-card/60">
                  <th className="px-3 py-2 text-left font-semibold">version</th>
                  {["fabric", "forge", "neoforge"].map((loader) => (
                    <th key={loader} className="px-3 py-2 text-center font-semibold">{loader}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(matrix.map((c) => c.version))).map((version) => (
                  <tr key={version} className="border-b border-border/40">
                    <td className="px-3 py-1.5 font-mono">
                      {version}
                      {matrix.find((c) => c.version === version)?.experimental ? (
                        <span className="ml-1.5 text-[9px] text-amber-400" title="beyond the fully-tested eras">exp</span>
                      ) : null}
                    </td>
                    {["fabric", "forge", "neoforge"].map((loader) => {
                      const cell = matrix.find((c) => c.version === version && c.loader === loader)!;
                      return (
                        <td key={loader} className="px-3 py-1.5 text-center">
                          {cell.available ? (
                            <span title={`${loader} available for ${version}`}><CheckCircle2 className="mx-auto h-3.5 w-3.5 text-emerald-400" /></span>
                          ) : (
                            <span className="text-muted-foreground/40" title={`no ${loader} toolchain for ${version}`}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
