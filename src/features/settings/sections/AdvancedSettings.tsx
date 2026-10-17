import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiagnosticsDialog } from "@/components/DiagnosticsDialog";
import { getAppPaths, openInFileManager } from "@/services/storage/storageService";
import { useSettingsStore } from "@/stores/settingsStore";
import { Field, InfoRow, SectionHeader } from "../SettingsBits";
import type { AppPaths } from "@/types";

export function AdvancedSettings() {
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);

  useEffect(() => {
    getAppPaths()
      .then(setPaths)
      .catch(() => setPaths(null));
  }, []);

  return (
    <section>
      <SectionHeader
        title="Advanced"
        description="Diagnostics, database location and low-level paths."
      />

      <Field
        label="Self-diagnostics"
        hint="If something doesn't work (creating servers, downloading jars, listing projects), this runs every real check — storage, database, Java and the official servers — and tells you exactly what is broken and how to fix it."
      >
        <DiagnosticsDialog
          basePath={basePath}
          trigger={
            <Button variant="gradient" size="sm">
              <Stethoscope className="h-3.5 w-3.5" />
              Run diagnostics
            </Button>
          }
        />
      </Field>

      <Field
        label="Application paths"
        hint="Internal locations used by the app. The database stores settings, projects and agent audits."
      >
        <div className="max-w-md rounded-lg border border-border/70 bg-card/60 p-4">
          <InfoRow label="Config dir" value={paths?.configDir ?? "…"} />
          <InfoRow label="Data dir" value={paths?.dataDir ?? "…"} />
          <InfoRow label="SQLite database" value={paths?.databasePath ?? "…"} />
          <div className="pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!paths}
              onClick={() =>
                paths &&
                void openInFileManager(paths.configDir).catch(() =>
                  toast.error("Could not open config folder"),
                )
              }
            >
              Open config folder
            </Button>
          </div>
        </div>
      </Field>

      <Field
        label="Database schema"
        hint="18 tables are provisioned on first run via versioned migrations — projects, instances, servers, backups, ai_tool_calls audit and more."
      >
        <div className="max-w-md rounded-lg border border-border/70 bg-card/60 p-4 text-xs leading-relaxed text-muted-foreground">
          Migrations are idempotent and versioned. Future releases append new
          migrations — never rewrite your data.
        </div>
      </Field>
    </section>
  );
}
