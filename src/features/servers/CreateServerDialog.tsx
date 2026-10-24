import { useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { useNavigate } from "react-router-dom";
import { Download, Globe, Loader2, Wand2 } from "lucide-react";
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
import { BriefingPicker } from "@/components/BriefingPicker";
import { writeBriefingDocuments } from "@/services/documents/documentsService";

const RAM_OPTIONS = [1024, 2048, 4096, 8192];

export interface CreateServerInitials {
  preset: ServerStylePreset | null;
  name: string | null;
  properties: Record<string, string>;
  /** community address whose live style pre-fills the wizard (from the cards) */
  importedAddress?: string;
  modules?: ServerModuleId[];
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
  const defaults = useSettingsStore((s) => s.settings.minecraft);
  const [software, setSoftware] = useState<"vanilla" | "paper">("vanilla");
  const [versions, setVersions] = useState<MinecraftVersionInfo[]>([]);
  const [mcVersion, setMcVersion] = useState<string>("");
  const [port, setPort] = useState("25565");
  const [ram, setRam] = useState(2048);
  const [acceptEula, setAcceptEula] = useState(false);
  const [makePublic, setMakePublic] = useState(false);
  const [modules, setModules] = useState<Set<ServerModuleId>>(new Set());
  const [monumentSeed, setMonumentSeed] = useState<number>(1337);
  const [busy, setBusy] = useState(false);
  // World setup — real server.properties keys, curated by the user
  const [worldSeed, setWorldSeed] = useState("");
  const [worldType, setWorldType] = useState<"normal" | "flat" | "amplified" | "large_biomes">("normal");
  const [difficulty, setDifficulty] = useState<"easy" | "normal" | "hard">("normal");
  const [generateStructures, setGenerateStructures] = useState(true);
  // The user's own briefing documents — extracted now, written after create
  const [briefingDocs, setBriefingDocs] = useState<{ fileName: string; kind: string; text: string }[]>([]);

  const slug = useMemo(() => slugify(name), [name]);
  const activePreset = presetId
    ? SERVER_STYLE_PRESETS.find((p) => p.id === presetId) ?? null
    : null;

  // Settings → Minecraft defaults pre-fill the wizard every time it opens
  useEffect(() => {
    if (!open) return;
    // defaults pre-fill off the synchronous effect path
    void Promise.resolve().then(() => {
      setSoftware(defaults.defaultServerSoftware);
      setRam(defaults.defaultServerRamMb);
      setPort(String(defaults.defaultServerPort));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Apply an import-panel handoff whenever the dialog opens with one
  useEffect(() => {
    if (!open) return;
    if (!initials) return;
    // handoff pre-fill off the synchronous effect path
    void Promise.resolve().then(() => {
      setPresetId(initials.preset?.id ?? null);
      setStyleProperties(initials.properties);
      if (initials.name) setName(initials.name);
      // Community card flow: ping the real server and infer the style live
      if (initials.importedAddress) {
        import("@/services/servers/serverPingService")
          .then(async ({ pingServer }) => {
            const ping = await pingServer(initials.importedAddress!);
            const { inferPresetFromPing } = await import("@/services/servers/inferStyle");
            const preset = inferPresetFromPing(ping);
            setPresetId(preset.id);
            setModules(new Set(preset.modules));
            toast.success(`Style imported from ${initials.importedAddress}`, {
              description: `Detected "${preset.name}" — modules and properties pre-filled from the live ping.`,
              duration: 9000,
            });
          })
          .catch((e) => {
            toast.warning("Could not ping that address", {
              description: `${String(e)} — pick a preset manually instead.`,
            });
          });
      }
      if (initials.preset) {
        setSoftware(initials.preset.software);
        setRam(initials.preset.ramMb);
        setModules(new Set(initials.preset.modules));
      }
    });
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
      .catch(() => {
        // getVersions is fallback-guarded, but if even the fallback fails
        // the user must KNOW — a silent empty version picker is unusable
        setVersions([]);
        toast.warning("Could not load Minecraft versions", {
          description:
            "Even the offline list failed. Run diagnostics (Settings → Advanced) and retry — the picker needs at least one version.",
          duration: 12000,
        });
      });
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

  const missingRequirement = (): string | null => {
    if (!basePath) return "storage";
    if (slug.length < 2) return "slug";
    if (!mcVersion) return "mcVersion";
    if (!/^\d{4,5}$/.test(port)) return "port";
    if (!acceptEula) return "eula";
    return null;
  };

  const handleCreate = async () => {
    if (busy) return;
    const missing = missingRequirement();
    if (missing) {
      if (missing === "storage") {
        toast.error("Configure your storage location first", {
          description: "Settings → Storage",
        });
        navigate("/settings/storage");
      } else if (missing === "eula") {
        toast.warning("Accept the Minecraft EULA to enable creation", {
          description:
            "The checkbox is right below the version picker — the server refuses to boot without it (Mojang's rule, not ours).",
          duration: 8000,
        });
      } else if (missing === "port") {
        toast.warning("Pick a valid port (4-5 digits)", {
          description: `Port "${port}" is not a valid port number (1024-65535).`,
        });
      } else if (missing === "slug") {
        toast.warning("Name your server first", {
          description: "Type a name — the id (slug) is generated from it.",
        });
      } else {
        toast.warning("Pick the Minecraft version first");
      }
      return;
    }
    setBusy(true);
    try {
      const worldProperties: Record<string, string> = {
        "level-type": `minecraft:${worldType}`,
        difficulty,
        "generate-structures": String(generateStructures),
      };
      if (worldSeed.trim()) {
        worldProperties["level-seed"] = worldSeed.trim();
      }
      const properties = { ...activePreset?.properties, ...styleProperties, ...worldProperties };
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
        const files = generateSelectedModules(selected, {
          ...DEFAULT_MODULE_OPTIONS,
          mcVersion,
        });
        for (const file of files) {
          await writeProjectFile(basePath, `servers/${slug}/${file.path}`, file.content);
        }
      }
      // Monuments ships REAL .nbt structures — the Rust generator writes
      // them straight into the module's datapack (era-factual, server
      // version, owner-chosen seed for a personal skyline)
      if (selected.includes("monuments")) {
        const { MONUMENT_STRUCTURES } = await import("@/services/servers/serverModules");
        const { generateStructure } = await import("@/services/assets/structureService");
        for (const monument of MONUMENT_STRUCTURES) {
          await generateStructure({
            storageBase: basePath,
            projectRel: `servers/${slug}`,
            structureId: monument.structureId,
            kind: monument.kind,
            seed: monumentSeed,
            mcVersion: mcVersion,
            previewOnly: false,
            outputKind: "server_module",
          });
        }
      }
      // The user's own documents become the server's briefing — the agent
      // reads them whenever it customizes this server further
      if (briefingDocs.length > 0) {
        try {
          await writeBriefingDocuments(basePath, `servers/${slug}/.voxel/briefing`, briefingDocs);
        } catch (error) {
          toast.warning("Briefing documents could not be attached", {
            description: `${error instanceof Error ? error.message : String(error)} — the server itself was created normally.`,
          });
        }
      }

      // The DOSSIER: full documentation of this server (versions, every
      // command, areas, economy, appendices — 30+ pages in 6 formats).
      // Generated right at creation, best-effort: the server exists either way.
      invoke<{ pages: number }>("server_generate_dossier", { basePath, slug })
        .then((result) => {
          toast.success(`Server dossier generated (${result.pages} pages)`, {
            description: `servers/${slug}/Dossier/ — .md, .txt, .html, .pdf, .docx and .odt. Customize → Dossier saves them anywhere.`,
            duration: 12000,
          });
        })
        .catch(() => {
          // generation is best-effort; a toast would be noise on top of success
        });

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

      // ONLINE: free public address (playit.gg) — the address shows in the console
      if (makePublic) {
        try {
          const { tunnelSetup, tunnelStart } = await import("@/services/servers/economyService");
          await tunnelSetup(basePath);
          await tunnelStart({ basePath, slug, port: Number(port) });
          toast.success("Public tunnel started", {
            description: `Your server is reachable from anywhere in ~30s — the *.playit.gg address appears in the Economy/tunnel panel and the console header.`,
            duration: 12000,
          });
        } catch (error) {
          toast.warning("Tunnel could not start now", {
            description: `${error instanceof Error ? error.message : String(error)} — the server itself is running locally; start the tunnel from the console anytime.`,
            duration: 10000,
          });
        }
      }

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

          <div className="space-y-3 rounded-lg border border-border/60 bg-card/50 p-3">
            <div className="flex items-center gap-1.5">
              <Globe className="h-3 w-3 text-primary" />
              <p className="text-xs font-semibold">{t("World setup")}</p>
              <span className="text-[10px] text-muted-foreground">
                {t("terrain, seed and rules — straight into server.properties")}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="world-seed">{t("Seed (optional)")}</Label>
                <Input
                  id="world-seed"
                  placeholder="e.g. 12345 or leave empty for random"
                  value={worldSeed}
                  onChange={(e) => setWorldSeed(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Terrain")}</Label>
                <Select value={worldType} onValueChange={(v) => setWorldType(v as typeof worldType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">{t("Normal (default world)")}</SelectItem>
                    <SelectItem value="large_biomes">{t("Large biomes")}</SelectItem>
                    <SelectItem value="amplified">{t("Amplified (extreme mountains)")}</SelectItem>
                    <SelectItem value="flat">{t("Superflat")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Difficulty")}</Label>
                <Select value={difficulty} onValueChange={(v) => setDifficulty(v as typeof difficulty)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Peaceful-ish (easy)</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                <span className="text-[11px] text-muted-foreground">{t("Generate structures")}</span>
                <Switch checked={generateStructures} onCheckedChange={setGenerateStructures} />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-card/50 p-3">
            <BriefingPicker docs={briefingDocs} onChange={setBriefingDocs} />
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

          <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/40 px-3 py-2.5">
            <Switch checked={makePublic} onCheckedChange={setMakePublic} />
            <div className="min-w-0">
              <p className="text-xs font-semibold">Make it public (free playit.gg address)</p>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                LOCAL by default. Check this to start a free public tunnel after
                creation — friends connect from anywhere via a *.playit.gg address
                (the address appears in the console).
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Gameplay modules (mix freely)")}</Label>
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
            {modules.has("monuments") && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 px-3 py-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Monument seed
                </span>
                <input
                  type="number"
                  className="h-7 w-24 rounded-md border border-border bg-card/60 px-2 text-xs outline-none focus:border-primary"
                  value={monumentSeed}
                  onChange={(e) =>
                    setMonumentSeed(Math.max(0, Number(e.target.value) || 0))
                  }
                />
                <span className="text-[10px] text-muted-foreground">
                  same seed, same skyline — every monument on this server
                  builds from it
                </span>
              </div>
            )}
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
            disabled={busy}
            title={canCreate ? "" : "Click to see what's missing"}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Creating…" : "Create server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
