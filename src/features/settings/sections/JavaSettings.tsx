import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/stores/settingsStore";
import { detectEnvironment } from "@/services/environment/environmentService";
import { Field, InfoRow, SectionHeader } from "../SettingsBits";
import type { EnvironmentInfo } from "@/types";

export function JavaSettings() {
  const customJavaPath = useSettingsStore((s) => s.settings.java.customJavaPath);
  const update = useSettingsStore((s) => s.update);
  const [env, setEnv] = useState<EnvironmentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [pathDraft, setPathDraft] = useState(customJavaPath);

  const refresh = () => {
    setLoading(true);
    detectEnvironment()
      .then(setEnv)
      .catch(() => setEnv(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // a microtask keeps the synchronous setLoading(true) out of the effect body
    void Promise.resolve().then(refresh);
  }, []);

  const javaOk = env?.java.found ?? false;

  return (
    <section>
      <SectionHeader
        title="Java"
        description="Minecraft 1.20.1 requires Java 17+. Gradle toolchains handle the exact JDK per project automatically."
      />

      <Field label="Detected runtime" hint="Checked live on your machine.">
        <div className="space-y-2 rounded-lg border border-border/70 bg-card/60 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">java -version</span>
            <Button variant="ghost" size="icon" onClick={refresh} title="Re-detect">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
          <InfoRow label="Status" value={javaOk ? "found" : "not found"} />
          <InfoRow
            label="Version"
            value={env?.java.versionString ?? "—"}
          />
          <InfoRow
            label="Major"
            value={env?.java.majorVersion ? `Java ${env.java.majorVersion}` : "—"}
          />
          {javaOk && env?.java.majorVersion !== null && (
            <div className="pt-1">
              {env && env.java.majorVersion !== null && env.java.majorVersion >= 17 ? (
                <Badge variant="success">
                  Compatible with Minecraft 1.20.1 toolchains
                </Badge>
              ) : (
                <Badge variant="warning">
                  Below Java 17 — install a newer JDK for mod development
                </Badge>
              )}
            </div>
          )}
        </div>
      </Field>

      <Field
        label="Custom Java path"
        hint="Optional. Leave empty to use the java binary on your PATH. Used for builds and future launch profiles."
      >
        <div className="max-w-md space-y-1.5">
          <Input
            placeholder="/usr/lib/jvm/java-21-openjdk/bin/java"
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            onBlur={() => {
              if (pathDraft !== customJavaPath) {
                update("java", { customJavaPath: pathDraft.trim() }).catch(() => {
                  toast.error("Could not save Java path");
                  setPathDraft(customJavaPath);
                });
              }
            }}
            className="font-mono text-xs"
          />
        </div>
      </Field>
    </section>
  );
}
