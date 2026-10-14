import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { Badge } from "@/components/ui/badge";
import { getProviderMeta } from "@/services/ai/providers";
import { secretsHas, AI_API_KEY_ID } from "@/services/secrets/secretsService";

const ROUTE_LABELS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^\/$/, label: "Home" },
  { pattern: /^\/projects\/[^/]+/, label: "Workspace / Project" },
  { pattern: /^\/launcher/, label: "Workspace / Launcher" },
    { pattern: /^\/modpacks/, label: "Workspace / Modpacks" },
    { pattern: /^\/studio/, label: "Workspace / Asset Studio" },
    { pattern: /^\/marketplace/, label: "Workspace / Marketplace" },
  { pattern: /^\/projects/, label: "Workspace / Projects" },
  { pattern: /^\/ai-creator/, label: "Workspace / AI Creator" },
  { pattern: /^\/shaders/, label: "Workspace / Shaders" },
  { pattern: /^\/servers/, label: "Workspace / Servers" },
  { pattern: /^\/settings\/general/, label: "Settings / General" },
  { pattern: /^\/settings\/appearance/, label: "Settings / Appearance" },
  { pattern: /^\/settings\/ai/, label: "Settings / AI" },
  { pattern: /^\/settings\/minecraft/, label: "Settings / Minecraft" },
  { pattern: /^\/settings\/java/, label: "Settings / Java" },
  { pattern: /^\/settings\/launcher/, label: "Settings / Launcher" },
  { pattern: /^\/settings\/mobile/, label: "Settings / Mobile" },
  { pattern: /^\/settings\/github/, label: "Settings / GitHub" },
  { pattern: /^\/settings\/storage/, label: "Settings / Storage" },
  { pattern: /^\/settings\/security/, label: "Settings / Security" },
  { pattern: /^\/settings\/advanced/, label: "Settings / Advanced" },
];

function currentBreadcrumb(pathname: string): string {
  return ROUTE_LABELS.find((r) => r.pattern.test(pathname))?.label ?? "VOXEL";
}

export function Topbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const aiSettings = useSettingsStore((s) => s.settings.ai);
  const [hasKey, setHasKey] = useState(false);

  const provider = getProviderMeta(aiSettings.provider);
  const needsKey = provider.requiresKey;
  const keyReady = !needsKey || hasKey;
  const aiReady = keyReady && aiSettings.model.trim().length > 0;

  useEffect(() => {
    let cancelled = false;
    if (!needsKey) {
      setHasKey(false);
      return;
    }
    secretsHas(AI_API_KEY_ID)
      .then((result) => {
        if (!cancelled) setHasKey(result);
      })
      .catch(() => {
        if (!cancelled) setHasKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, [aiSettings.provider, needsKey, pathname]);

  const activeProject = pathname.startsWith("/projects/")
    ? useProjectsStore.getState().projects.find((p) => pathname.includes(p.id))
    : undefined;

  return (
    <header className="glass flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground/90">
          {activeProject
            ? `Workspace / Projects / ${activeProject.name}`
            : currentBreadcrumb(pathname)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex h-8 items-center gap-2 rounded-md border border-border/80 bg-background/60 px-3 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search commands</span>
          <span className="kbd ml-2">Ctrl K</span>
        </button>

        <button onClick={() => navigate("/settings/ai")} title="AI configuration">
          <Badge variant={aiReady ? "success" : "warning"}>
            <span
              className={
                "mr-0.5 h-1.5 w-1.5 rounded-full " +
                (aiReady ? "bg-emerald-400" : "bg-amber-400")
              }
            />
            {aiReady
              ? `AI · ${provider.label}`
              : hasKey
                ? "AI · model missing"
                : needsKey
                  ? "AI not configured"
                  : "Ollama · model missing"}
          </Badge>
        </button>
      </div>
    </header>
  );
}
