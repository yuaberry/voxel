import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/stores/settingsStore";
import { Field, InfoRow, SectionHeader } from "../SettingsBits";
import {
  ensureCatalog,
  getVersions,
  javaReleaseFor,
} from "@/services/minecraft/versionCatalog";
import type { CatalogStatus, MinecraftVersionInfo } from "@/types/catalog";
import { formatRelativeTime } from "@/lib/utils";

export function MinecraftSettings() {
  const minecraft = useSettingsStore((s) => s.settings.minecraft);
  const update = useSettingsStore((s) => s.update);
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [versions, setVersions] = useState<MinecraftVersionInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const loadCatalog = async (force = false) => {
    setBusy(true);
    try {
      const result = await ensureCatalog(force);
      setStatus(result);
      setVersions(await getVersions());
      if (force) {
        toast.success("Version catalog updated", {
          description: `${result.count} versions synced from Mojang + community sources.`,
        });
      }
    } catch (error) {
      toast.error("Could not refresh catalog", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadCatalog(false);
  }, []);

  const releases = versions.filter((v) => v.kind === "release").slice(0, 40);
  const defaultInfo = versions.find((v) => v.version === minecraft.defaultVersion);
  const paperForDefault = defaultInfo?.serverSoftware.includes("paper") ?? false;

  return (
    <section>
      <SectionHeader
        title="Minecraft"
        description="Versions are resolved live from the auto-updating catalog — official (Mojang) and community (Fabric, Forge, NeoForge, Paper)."
      />

      <Field
        label="Version catalog"
        hint="Synced on launch and refreshed automatically every 12 hours. Falls back to the cache when offline."
      >
        <div className="max-w-md space-y-2 rounded-lg border border-border/70 bg-card/60 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : (
                <span
                  className={
                    "h-2.5 w-2.5 rounded-full " +
                    (status?.source === "fresh"
                      ? "bg-emerald-400"
                      : status?.source === "cache"
                        ? "bg-amber-400"
                        : "bg-red-400")
                  }
                />
              )}
              <span className="text-sm font-medium">
                {status
                  ? status.source === "fresh"
                    ? "Synced live"
                    : status.source === "cache"
                      ? "Cached (offline-tolerant)"
                      : "Embedded fallback"
                  : "Checking…"}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => void loadCatalog(true)}
              disabled={busy}
            >
              <RefreshCw className={"h-3 w-3 " + (busy ? "animate-spin" : "")} />
              Refresh now
            </Button>
          </div>
          <InfoRow label="Versions" value={status ? String(status.count) : "…"} />
          <InfoRow
            label="Last sync"
            value={
              status?.lastFetchedAt ? formatRelativeTime(status.lastFetchedAt) : "never"
            }
          />
        </div>
      </Field>

      <Field
        label="Default Minecraft version"
        hint="Pre-selected in the project wizard. Every listed version has its loader data (yarn, Fabric API) resolved from the catalog."
      >
        <div className="max-w-sm">
          <Select
            value={minecraft.defaultVersion}
            onValueChange={(value) =>
              update("minecraft", { defaultVersion: value }).catch(() =>
                toast.error("Could not save version preference"),
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {releases.map((v) => (
                <SelectItem key={v.version} value={v.version}>
                  {v.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Field>

      <Field
        label="Default mod loader"
        hint="Fabric templates are live; Forge and NeoForge plug into the same Version Adapter in Phase 3."
      >
        <div className="max-w-sm">
          <Select
            value={minecraft.defaultLoader}
            onValueChange={(value) =>
              update("minecraft", {
                defaultLoader: value as typeof minecraft.defaultLoader,
              }).catch(() => toast.error("Could not save loader preference"))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fabric">Fabric</SelectItem>
              <SelectItem value="forge">Forge (Phase 3)</SelectItem>
              <SelectItem value="neoforge">NeoForge (Phase 3)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Field>

      <Field
        label="Default server software"
        hint="Used by the Server Studio wizard (Phase 6). Paper availability is tracked per version by the catalog."
      >
        <div className="flex max-w-sm items-center gap-3">
          <Select
            value={minecraft.defaultServerSoftware}
            onValueChange={(value) =>
              update("minecraft", {
                defaultServerSoftware: value as typeof minecraft.defaultServerSoftware,
              }).catch(() => toast.error("Could not save server preference"))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vanilla">Vanilla</SelectItem>
              <SelectItem value="paper" disabled={!paperForDefault && versions.length > 0}>
                Paper{!paperForDefault && versions.length > 0 ? " (not for this version)" : ""}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Field>

      <Field
        label="Default server RAM & port"
        hint="What the server wizard starts with — your usual setup, pre-filled every time."
      >
        <div className="flex max-w-sm items-center gap-3">
          <Select
            value={String(minecraft.defaultServerRamMb)}
            onValueChange={(value) =>
              update("minecraft", {
                defaultServerRamMb: Number(value),
              }).catch(() => toast.error("Could not save server preference"))
            }
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1024">1 GB</SelectItem>
              <SelectItem value="2048">2 GB</SelectItem>
              <SelectItem value="4096">4 GB</SelectItem>
              <SelectItem value="8192">8 GB</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="w-28"
            inputMode="numeric"
            value={minecraft.defaultServerPort}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 5);
              if (digits) {
                update("minecraft", { defaultServerPort: Number(digits) }).catch(() => {});
              }
            }}
            title="Default port"
          />
        </div>
      </Field>

      {defaultInfo && (
        <Field label="Selected version details" hint="Live data for the current default.">
          <div className="max-w-md space-y-1 rounded-lg border border-border/70 bg-card/60 p-4">
            <InfoRow label="Java" value={`Java ${javaReleaseFor(defaultInfo.version)}`} />
            <InfoRow
              label="Fabric yarn"
              value={defaultInfo.fabric?.yarn ?? "not available"}
            />
            <InfoRow
              label="Fabric API"
              value={defaultInfo.fabric?.fabricApi ?? "not available"}
            />
            <InfoRow
              label="Forge recommended"
              value={defaultInfo.forge?.recommended ?? "—"}
            />
            <InfoRow
              label="NeoForge latest"
              value={defaultInfo.neoforge?.latest ?? "—"}
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {defaultInfo.loaders.map((l) => (
                <Badge key={l} variant="default">
                  {l}
                </Badge>
              ))}
              {defaultInfo.serverSoftware.map((s) => (
                <Badge key={s} variant="secondary">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        </Field>
      )}
    </section>
  );
}
