import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settingsStore";
import { getVersions } from "@/services/minecraft/versionCatalog";
import {
  createServerCommand,
  slugify,
} from "@/services/servers/serverService";
import { insertServer } from "@/services/db/repositories/serversRepository";
import type { MinecraftVersionInfo } from "@/types/catalog";
import type { ServerRecord } from "@/types";
import {
  DEFAULT_MODULE_OPTIONS,
  generateSelectedModules,
  SERVER_MODULES,
  type ServerModuleId,
} from "@/services/servers/serverModules";
import {
  SERVER_STYLE_PRESETS,
  type ServerStylePreset,
} from "@/services/servers/serverPresets";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";

const RAM_OPTIONS = [1024, 2048, 4096, 8192];

export interface CreateServerInitials {
  preset: ServerStylePreset | null;
  name: string | null;
  properties: Record<string, string>;
}

export function CreateServerDialog({
  open,
  onOpenChange,
  initials,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Style/name/properties coming from the import panel (or none) */
  initials?: CreateServerInitials | null;
}) {
  const navigate = useNavigate();
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);

  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState<string | null>(null);
  const [styleProperties, setStyleProperties] = useState<Record<string, string>>({});
  const [software, setSoftware] = useState<"vanilla" | "paper">("vanilla");
  const [versions, setVersions] = useState<MinecraftVersionInfo[]>([]);
  const [mcVersion, setMcVersion] = useState<string>("");
  const [port, setPort] = useState("25565");
  const [ram, setRam] = useState(2048);
  const [acceptEula, setAcceptEula] = useState(false);
  const [modules, setModules] = useState<Set<ServerModuleId>>(new Set());
  const [busy, setBusy] = useState(false);

  const slug = useMemo(() => slugify(name), [name]);
  const activePreset = presetId
    ? SERVER_STYLE_PRESETS.find((p) => p.id === presetId) ?? null
    : null;

  // Apply an import-panel handoff whenever the dialog opens with one
  useEffect(() => {
    if (!open) return;
    if (initials) {
      setPresetId(initials.preset?.id ?? null);
      setStyleProperties(initials.properties);
      if (initials.name) setName(initials.name);
      if (initials.preset) {
        setSoftware(initials.preset.software);
        setRam(initials.preset.ramMb);
        setModules(new Set(initials.preset.modules));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void getVersions()
      .then((list) => {
        const releases = list.filter((v) => v.kind === "release").slice(0, 30);
        setVersions(releases);
        if (!mcVersion && releases.length > 0) setMcVersion(releases[0].version);
      })
      .catch(() => setVersions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyPreset = (preset: ServerStylePreset | null) => {
    setPresetId(preset?.id ?? null);
    setStyleProperties({});
    if (preset) {
      setSoftware(preset.software);
      setRam(preset.ramMb);
      setModules(new Set(preset.modules));
    }
  };

  const canCreate =
    slug.length >= 2 && mcVersion.length > 0 && acceptEula && /^\d{4,5}$/.test(port);

  const toggleModule = (id: ServerModuleId) => {
    setModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!canCreate || !basePath) {
      if (!basePath) {
        toast.error("Configure your storage location first", {
          description: "Settings → Storage",
        });
        navigate("/settings/storage");
      }
      return;
    }
    setBusy(true);
    try {
      const properties = { ...activePreset?.properties, ...styleProperties };
      const result = await createServerCommand({
        basePath,
        slug,
        name: name.trim(),
        software,
        mcVersion,
        port: Number(port),
        ramMb: ram,
        acceptEula,
        properties: Object.keys(properties).length > 0 ? properties : undefined,
      });
      // Mixable modules — install datapacks before the first boot
      const selected = [...modules];
      if (selected.length > 0) {
        const { writeProjectFile } = await import("@/services/projects/projectsService");
        const files = generateSelectedModules(selected, DEFAULT_MODULE_OPTIONS);
        for (const file of files) {
          await writeProjectFile(basePath, `servers/${slug}/${file.path}`, file.content);
        }
      }
      // The server README documents exactly what got installed (objectives
      // + in-game commands per module) — rewritten with the real facts
      await invoke("server_write_info", {
        payload: {
          storageBase: basePath,
          slug,
          name: name.trim(),
          software,
          mcVersion,
          ramMb: ram,
          modules: selected,
        },
      }).catch(() => {
        // documentation is best-effort — the server itself is already real
      });

      const now = new Date().toISOString();
      const record: ServerRecord = {
        id: crypto.randomUUID(),
        name: name.trim(),
        slug,
        software,
        minecraft_version: mcVersion,
        path: result.serverDir,
        port: Number(port),
        ram_mb: ram,
        status: "stopped",
        created_at: now,
        updated_at: now,
      };
      await insertServer(record);

      // Initialize the token chain ledger when the module is selected
      if (selected.includes("token")) {
        const { initLedger } = await import("@/services/servers/economyService");
        await initLedger(basePath, slug, "VoxelCoin").catch(() => {});
      }
      toast.success(`Server "${name.trim()}" created`, {
        description: "Official jar downloaded and verified. Open the console to start it.",
      });
      setName("");
      setAcceptEula(false);
      setPresetId(null);
      setStyleProperties({});
      onOpenChange(false);
    } catch (error) {
      toast.error("Could not create server", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create server</DialogTitle>
          <DialogDescription>
            Start from a ready-made style (or keep it fully manual) — official
            jar (Mojang/Paper), verified checksums, isolated under your workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Ready-made styles */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Wand2 className="h-3 w-3 text-primary" />
              Server style
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => applyPreset(null)}
                className={cn(
                  "rounded-lg border p-2.5 text-left transition-colors",
                  presetId === null
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/60 bg-card/40 hover:border-primary/30",
                )}
              >
                <p className="text-xs font-semibold">Manual</p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                  Configure everything yourself
                </p>
              </button>
              {SERVER_STYLE_PRESETS.map((preset) => {
                const active = presetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    title={preset.description}
                    className={cn(
                      "rounded-lg border p-2.5 text-left transition-colors",
                      active
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/60 bg-card/40 hover:border-primary/30",
                    )}
                  >
                    <p className="flex items-center justify-between gap-1 text-xs font-semibold">
                      <span className="truncate">{preset.name}</span>
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          preset.category === "official" ? "bg-cyan-400" : "bg-purple-400",
                        )}
                      />
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {preset.tagline}
                    </p>
                  </button>
                );
              })}
            </div>
            {activePreset && (
              <p className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                {activePreset.description}
              </p>
            )}
            {presetId === null && Object.keys(styleProperties).length > 0 && (
              <p className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                AI-designed style applied — {Object.keys(styleProperties).length} curated
                properties will be written to server.properties.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="server-name">Server name</Label>
            <Input
              id="server-name"
              autoFocus
              placeholder="e.g. Kingdom SMP"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {slug && (
              <p className="font-mono text-[10px] text-muted-foreground">
                {basePath ? `${basePath}/servers/` : ""}
                {slug}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Software</Label>
              <Select value={software} onValueChange={(v) => setSoftware(v as typeof software)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vanilla">Vanilla</SelectItem>
                  <SelectItem value="paper">Paper</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Minecraft version</Label>
              <Select value={mcVersion} onValueChange={setMcVersion}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.version} value={v.version}>
                      {v.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="server-port">Port</Label>
              <Input
                id="server-port"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>RAM</Label>
              <div className="flex flex-wrap gap-1.5">
                {RAM_OPTIONS.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={ram === option ? "default" : "outline"}
                    onClick={() => setRam(option)}
                  >
                    {option / 1024}G
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/50 p-3">
            <Switch checked={acceptEula} onCheckedChange={setAcceptEula} />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              I accept the{" "}
              <a
                className="text-primary hover:underline"
                href="https://aka.ms/MinecraftEULA"
                onClick={(e) => e.preventDefault()}
                title="https://aka.ms/MinecraftEULA"
              >
                Minecraft EULA
              </a>
              . The server runs with online-mode=true — no account bypass, ever.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Gameplay modules (mix freely)</Label>
            <div className="grid gap-2">
              {SERVER_MODULES.map((module) => {
                const checked = modules.has(module.id);
                return (
                  <button
                    key={module.id}
                    type="button"
                    onClick={() => toggleModule(module.id)}
                    className={
                      "flex items-start gap-2 rounded-lg border p-3 text-left transition-colors " +
                      (checked
                        ? "border-primary/50 bg-primary/10"
                        : "border-border/60 bg-card/40 hover:border-primary/30")
                    }
                  >
                    <span
                      className={
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] " +
                        (checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40")
                      }
                    >
                      {checked ? "✓" : ""}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-xs font-semibold">
                        {module.name}
                        <Badge variant="outline" className="text-[8px] uppercase">{module.tagline}</Badge>
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                        {module.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <Badge variant="default">{software}</Badge>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Download className="h-3 w-3" /> jar fetched at creation · backups
              and console included
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="gradient"
            onClick={() => void handleCreate()}
            disabled={busy || !canCreate}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Creating…" : "Create server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
