import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { toast } from "sonner";
import {
  Boxes,
  FileText,
  Globe,
  Loader2,
  MessageSquareCode,
  PackagePlus,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { ServerRecord } from "@/types";
import { BriefingPicker } from "@/components/BriefingPicker";
import { CommandDraftEditor } from "@/components/CommandDraftEditor";
import {
  listBriefingDocuments,
  writeBriefingDocuments,
} from "@/services/documents/documentsService";
import { readProjectFile, writeProjectFile } from "@/services/projects/projectsService";
import {
  generateCustomCommandsDatapack,
  validateTriggerId,
  type CustomCommand,
} from "@/services/servers/customCommands";
import {
  searchModrinthMods,
  getModrinthVersions,
  pickModrinthFile,
  type ModrinthSearchHit,
} from "@/services/modpacks/modrinthService";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  getCurrency,
  saveCurrency,
  valueCurrency,
  type CurrencyConfig,
  type CurrencyValuation,
} from "@/services/servers/currencyService";
import { Coins, FileDown, Sparkles } from "lucide-react";
import { IsoStructureCanvas } from "@/features/studio/IsoStructureCanvas";
import {
  designServerPlan,
  previewPlanStructure,
  applyServerPlan,
  type ServerPlan,
} from "@/services/servers/aiServerStudio";
import { updateServerRecord } from "@/services/db/repositories/serversRepository";
import type { StructureGenResult } from "@/services/assets/structureService";

type Tab = "briefing" | "world" | "structures" | "commands" | "plugins" | "currency" | "dossier" | "ai";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "briefing", label: "Briefing", icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "world", label: "World", icon: <Globe className="h-3.5 w-3.5" /> },
  { id: "structures", label: "Structures", icon: <Boxes className="h-3.5 w-3.5" /> },
  { id: "commands", label: "Commands", icon: <MessageSquareCode className="h-3.5 w-3.5" /> },
  { id: "plugins", label: "Plugins", icon: <PackagePlus className="h-3.5 w-3.5" /> },
  { id: "currency", label: "Currency", icon: <Coins className="h-3.5 w-3.5" /> },
  { id: "dossier", label: "Dossier", icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "ai", label: "AI Studio", icon: <Sparkles className="h-3.5 w-3.5" /> },
];

/**
 * Customize server — the owner's autonomy ask in one place: bring your own
 * briefing docs, import a world, set the terrain rules in server.properties,
 * import .nbt structures, design CUSTOM COMMANDS (with mobs and the
 * /convert flow) and install Paper plugins from Modrinth. Every action is
 * real: files land where the server reads them.
 */
export function ServerCustomizeDialog({
  server,
  open,
  onOpenChange,
  basePath,
}: {
  server: ServerRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  basePath: string;
}) {
  const [tab, setTab] = useState<Tab>("briefing");
  const [busy, setBusy] = useState(false);
  const slug = server.slug;
  const isPaper = server.software === "paper";

  // ---- world state (server.properties facts, edited in place)
  const [motd, setMotd] = useState("A VOXEL server");
  const [levelSeed, setLevelSeed] = useState("");
  const [difficulty, setDifficulty] = useState("normal");
  const [maxPlayers, setMaxPlayers] = useState("20");
  const [pvp, setPvp] = useState(true);

  // ---- structures state
  const [placed, setPlaced] = useState<{ name: string; command: string }[]>([]);

  // ---- commands state
  const [hasEconomy, setHasEconomy] = useState(false);
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [draft, setDraft] = useState<CustomCommand | null>(null);

  // ---- plugins state
  const [pluginQuery, setPluginQuery] = useState("");
  const [pluginHits, setPluginHits] = useState<ModrinthSearchHit[]>([]);
  const [pluginBusy, setPluginBusy] = useState(false);

  // ---- briefing state
  const [briefDocs, setBriefDocs] = useState<{ fileName: string; kind: string; text: string }[]>([]);
  const [existingBriefs, setExistingBriefs] = useState<{ name: string; sizeBytes: number }[]>([]);

  // ---- currency state (the user's OWN token)
  const [currency, setCurrency] = useState<CurrencyConfig | null>(null);
  const [valuation, setValuation] = useState<CurrencyValuation | null>(null);
  const [mintAmount, setMintAmount] = useState("1000");

  // ---- dossier state
  const [dossier, setDossier] = useState<{ files: { format: string; path: string; bytes: number }[]; pages: number } | null>(null);

  // ---- AI Studio state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [plan, setPlan] = useState<ServerPlan | null>(null);
  const [planPreviews, setPlanPreviews] = useState<Record<string, StructureGenResult | null>>({});

  // ---- rename state (the World tab edits the server identity too)
  const [serverName, setServerName] = useState(server.name);

  const serverRel = `servers/${slug}`;

  useEffect(() => {
    if (!open) return;
    setTab("briefing");
    setPlaced([]);
    // world facts from the REAL properties file
    readProjectFile(basePath, `${serverRel}/server.properties`)
      .then((content) => {
        for (const line of content.split("\n")) {
          const [k, ...rest] = line.split("=");
          const v = rest.join("=");
          if (k === "motd") setMotd(v);
          if (k === "level-seed") setLevelSeed(v);
          if (k === "difficulty") setDifficulty(v);
          if (k === "max-players") setMaxPlayers(v);
          if (k === "pvp") setPvp(v === "true");
        }
      })
      .catch(() => {});
    // economy detection: the module pack on disk is the fact
    readProjectFile(basePath, `${serverRel}/world/datapacks/nexus_economy/pack.mcmeta`)
      .then(() => setHasEconomy(true))
      .catch(() => setHasEconomy(false));
    listBriefingDocuments(basePath, `${serverRel}/.voxel/briefing`).then(setExistingBriefs);
    setDossier(null);
    setPlan(null);
    setPlanPreviews({});
    setServerName(server.name);
    getCurrency(basePath, slug).then((cfg) => {
      setCurrency(cfg);
      if (cfg) {
        valueCurrency(basePath, slug, cfg).then(setValuation);
      } else {
        setValuation(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slug, basePath]);

  const saveProperties = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const content = await readProjectFile(basePath, `${serverRel}/server.properties`);
      const edited = new Map<string, string>([
        ["motd", motd],
        ["difficulty", difficulty],
        ["max-players", maxPlayers],
        ["pvp", String(pvp)],
        ...(levelSeed.trim() ? [["level-seed", levelSeed.trim()] as [string, string]] : []),
      ]);
      const lines = content
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#"))
        .map((line) => {
          const key = line.split("=")[0];
          return edited.has(key) ? `${key}=${edited.get(key)}` : line;
        });
      for (const [key, value] of edited) {
        if (!lines.some((l) => l.startsWith(`${key}=`))) {
          lines.push(`${key}=${value}`);
        }
      }
      await writeProjectFile(basePath, `${serverRel}/server.properties`, `${lines.join("\n")}\n`);
      toast.success("World rules saved", {
        description: "They apply on the next server start (a fresh seed needs a new world).",
      });
    } catch (error) {
      toast.error("Could not save server.properties", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const importWorld = async () => {
    if (busy) return;
    const picked = await openFileDialog({
      multiple: false,
      title: "Import a world zip",
      filters: [{ name: "World zip", extensions: ["zip"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    setBusy(true);
    try {
      const message = await invoke<string>("server_import_world", {
        basePath,
        slug,
        zipPath: picked,
      });
      toast.success("World imported", { description: message, duration: 12000 });
    } catch (error) {
      toast.error("World import failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const importStructures = async () => {
    if (busy) return;
    const picked = await openFileDialog({
      multiple: true,
      title: "Import structures (.nbt)",
      filters: [{ name: "Minecraft structure", extensions: ["nbt"] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    setBusy(true);
    try {
      const results: { name: string; command: string }[] = [];
      for (const filePath of paths) {
        const command = await invoke<string>("server_import_structure", {
          basePath,
          slug,
          filePath,
        });
        results.push({ name: filePath.split("/").pop() ?? filePath, command });
      }
      setPlaced((prev) => [...results, ...prev]);
      toast.success(
        results.length === 1 ? "Structure imported" : `${results.length} structures imported`,
        {
          description:
            "Run /reload on the server (or restart it), then place with the /place command shown in the list.",
          duration: 12000,
        },
      );
    } catch (error) {
      toast.error("Structure import failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const installCommands = async () => {
    if (busy) return;
    if (commands.length === 0) {
      toast.warning("No commands yet", {
        description: "Design one below — message, items, teleports, mobs, /convert…",
      });
      return;
    }
    setBusy(true);
    try {
      const files = generateCustomCommandsDatapack(commands, { hasEconomy });
      for (const file of files) {
        await writeProjectFile(basePath, `${serverRel}/${file.path}`, file.content);
      }
      toast.success(`Custom commands installed (${commands.length})`, {
        description: "Run /reload on the server (or restart) — players use /trigger <name>, no operator rights needed.",
        duration: 12000,
      });
    } catch (error) {
      toast.error("Could not install commands", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const searchPlugins = async () => {
    if (pluginBusy) return;
    setPluginBusy(true);
    try {
      const hits = await searchModrinthMods(
        pluginQuery.trim() || "essentials",
        server.minecraft_version,
        "paper",
      );
      setPluginHits(hits);
      if (hits.length === 0) {
        toast.info("No plugins found", {
          description: "Try another search — this looks at Modrinth's Paper plugin catalog for your version.",
        });
      }
    } catch (error) {
      toast.error("Modrinth search failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPluginBusy(false);
    }
  };

  const installPlugin = async (hit: ModrinthSearchHit) => {
    if (busy) return;
    setBusy(true);
    try {
      const versions = await getModrinthVersions(
        hit.project_id,
        server.minecraft_version,
        "paper",
      );
      const picked = pickModrinthFile(versions);
      if (!picked) {
        throw new Error(`no Paper ${server.minecraft_version} build published for this plugin`);
      }
      await invoke("modrinth_download", {
        payload: {
          storageBase: basePath,
          instanceSlug: slug,
          url: picked.url,
          sha1: picked.sha1,
          fileName: picked.fileName,
          outputKind: "server_plugins",
        },
      });
      toast.success(`Plugin installed: ${hit.title}`, {
        description: "It loads on the next server start — find its config under servers/<slug>/plugins/.",
        duration: 10000,
      });
    } catch (error) {
      toast.error("Plugin install failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const saveBriefings = async () => {
    if (busy || briefDocs.length === 0) return;
    setBusy(true);
    try {
      await writeBriefingDocuments(basePath, `${serverRel}/.voxel/briefing`, briefDocs);
      setBriefDocs([]);
      setExistingBriefs(await listBriefingDocuments(basePath, `${serverRel}/.voxel/briefing`));
      toast.success("Briefing attached to this server");
    } catch (error) {
      toast.error("Could not attach the briefing", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const renameServer = async () => {
    if (busy) return;
    const name = serverName.trim();
    if (!name || name === server.name) return;
    setBusy(true);
    try {
      await invoke("server_update_metadata", {
        basePath,
        slug,
        name,
        ramMb: null,
        port: null,
      });
      await updateServerRecord(slug, { name });
      toast.success(`Server renamed to "${name}"`, {
        description: "The manifest, the README and the list all carry the new name now.",
      });
    } catch (error) {
      toast.error("Could not rename the server", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const designWithAi = async () => {
    if (aiBusy || !aiPrompt.trim()) return;
    setAiBusy(true);
    setPlan(null);
    setPlanPreviews({});
    try {
      const { plan: designed } = await designServerPlan(aiPrompt.trim(), server);
      setPlan(designed);
      // PREVIEW every planned structure — real generation, nothing written
      const previews: Record<string, StructureGenResult | null> = {};
      for (const structure of designed.structures) {
        previews[structure.id] = await previewPlanStructure(
          structure,
          basePath,
          slug,
          server.minecraft_version,
        ).catch(() => null);
      }
      setPlanPreviews(previews);
      toast.success("Plan ready — preview everything, then install", {
        description: designed.summary.slice(0, 140),
        duration: 12000,
      });
    } catch (error) {
      toast.error("The AI could not design this", {
        description: error instanceof Error ? error.message : String(error),
        duration: 12000,
      });
    } finally {
      setAiBusy(false);
    }
  };

  const installPlan = async () => {
    if (busy || !plan) return;
    setBusy(true);
    try {
      const result = await applyServerPlan(plan, basePath, server);
      toast.success("Plan installed", {
        description:
          `${result.placed.length} structure${result.placed.length === 1 ? "" : "s"} on disk, ${result.commandsInstalled} command${result.commandsInstalled === 1 ? "" : "s"} in the datapack — run /reload and place them in-game.`,
        duration: 14000,
      });
      setPlan(null);
      setPlanPreviews({});
      // regenerate the dossier so the documentation carries the new truth
      invoke("server_generate_dossier", { basePath, slug }).catch(() => {});
    } catch (error) {
      toast.error("Install failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const saveTheCurrency = async () => {
    if (!currency || busy) return;
    setBusy(true);
    try {
      await saveCurrency(basePath, slug, currency);
      setValuation(await valueCurrency(basePath, slug, currency));
      toast.success(`Currency ${currency.name} (${currency.symbol}) saved`, {
        description:
          "In-game currency with real-economics dilution — more tokens minted, less value each. It is game money: no monetary value, no cash-out.",
        duration: 12000,
      });
    } catch (error) {
      toast.error("Could not save the currency", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const mintSupply = async () => {
    if (!currency || busy) return;
    const amount = Math.floor(Number(mintAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.warning("Pick how many tokens to mint");
      return;
    }
    setBusy(true);
    try {
      const { applyLedgerTx } = await import("@/services/servers/economyService");
      await applyLedgerTx({
        basePath,
        slug,
        tx: "mint",
        from: "genesis",
        to: "owner",
        amount,
      });
      setValuation(await valueCurrency(basePath, slug, currency));
      toast.success(`Minted ${amount.toLocaleString()} ${currency.symbol}`, {
        description:
          "Recorded on the SHA-256 chain. Watch the dilution: the more tokens circulating, the less each one is worth.",
        duration: 10000,
      });
    } catch (error) {
      toast.error("Mint failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const generateDossier = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await invoke<{ files: { format: string; path: string; bytes: number }[]; pages: number }>(
        "server_generate_dossier",
        { basePath, slug },
      );
      setDossier(result);
      toast.success(`Dossier ready — ${result.pages} pages`, {
        description: `Six reading formats under servers/${slug}/Dossier/ — and the save buttons copy them anywhere.`,
        duration: 10000,
      });
    } catch (error) {
      toast.error("Dossier generation failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const saveDossierFile = async (format: string, path: string) => {
    const rel = path.split(`servers/${slug}/`)[1];
    if (!rel) return;
    const dest = await saveDialog({
      title: `Save the dossier (${format})`,
      defaultPath: `Dossier-${slug}.${format}`,
    });
    if (!dest) return;
    try {
      await invoke("dossier_save_copy", { basePath, rel, destPath: dest });
      toast.success(`Saved ${format.toUpperCase()} to ${dest}`);
    } catch (error) {
      toast.error("Could not save", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const addDraft = () => {
    setDraft({
      id: "",
      description: "",
      actions: [],
      cooldownSeconds: 0,
      costCoins: 0,
    });
  };

  const saveDraft = () => {
    if (!draft) return;
    const idError = validateTriggerId(draft.id);
    if (idError) {
      toast.warning(idError);
      return;
    }
    if (draft.actions.length === 0) {
      toast.warning("Add at least one action", {
        description: "Message, title, give, teleport, effect, sound, mob summon or /convert.",
      });
      return;
    }
    if (commands.some((c) => c.id === draft.id)) {
      toast.warning("There is already a command with that id");
      return;
    }
    setCommands((prev) => [
      ...prev,
      {
        ...draft,
        cooldownSeconds: draft.cooldownSeconds && draft.cooldownSeconds > 0 ? draft.cooldownSeconds : undefined,
        costCoins: draft.costCoins && draft.costCoins > 0 ? draft.costCoins : undefined,
      },
    ]);
    setDraft(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("Customize server")}
            <Badge variant="outline" className="text-[10px]">
              {server.software} {server.minecraft_version}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {t(
              "Everything about this server is yours: briefing docs, the world itself, terrain rules, structures, custom commands with mobs, and (Paper) plugins.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                tab === item.id
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-primary/30",
              )}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>

        {tab === "briefing" && (
          <div className="space-y-3">
            <BriefingPicker docs={briefDocs} onChange={setBriefDocs} />
            {briefDocs.length > 0 && (
              <Button size="sm" variant="gradient" onClick={() => void saveBriefings()} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t("Attach to this server")}
              </Button>
            )}
            {existingBriefs.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-border/60 bg-card/50 p-3">
                <p className="text-xs font-semibold">{t("Attached briefings")}</p>
                {existingBriefs.map((b) => (
                  <p key={b.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <FileText className="h-3 w-3 text-primary" />
                    {b.name}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "world" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("Server name")}</Label>
              <div className="flex gap-2">
                <Input value={serverName} onChange={(e) => setServerName(e.target.value)} />
                <Button size="sm" variant="outline" onClick={() => void renameServer()} disabled={busy || !serverName.trim() || serverName.trim() === server.name}>
                  {t("Rename")}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>MOTD</Label>
                <Input value={motd} onChange={(e) => setMotd(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Level seed")}</Label>
                <Input
                  value={levelSeed}
                  placeholder="(empty = random)"
                  onChange={(e) => setLevelSeed(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Difficulty")}</Label>
                <Input value={difficulty} onChange={(e) => setDifficulty(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Max players")}</Label>
                <Input value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                <span className="text-[11px] text-muted-foreground">PvP</span>
                <Switch checked={pvp} onCheckedChange={setPvp} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="gradient" onClick={() => void saveProperties()} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t("Save world rules")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void importWorld()} disabled={busy}>
                <Globe className="h-3.5 w-3.5" />
                {t("Import a world (.zip)")}
              </Button>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {t(
                "A new seed needs a NEW world: stop the server, import a world or delete the world folder, then start it. Importing keeps your previous world aside — nothing is destroyed.",
              )}
            </p>
          </div>
        )}

        {tab === "structures" && (
          <div className="space-y-3">
            <Button size="sm" variant="gradient" onClick={() => void importStructures()} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              <Plus className="h-3.5 w-3.5" />
              {t("Import structures (.nbt)")}
            </Button>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {t(
                "Any .nbt works — exported from a structure block in-game, from a schematic tool or from our Asset Studio. After /reload, place them where you stand.",
              )}
            </p>
            {placed.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-border/60 bg-card/50 p-3">
                {placed.map((item) => (
                  <p
                    key={item.command}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="truncate text-muted-foreground">{item.name}</span>
                    <code className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                      {item.command}
                    </code>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "commands" && (
          <div className="space-y-3">
            {!hasEconomy && (
              <p className="rounded-lg border border-border/70 bg-card/40 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
                {t(
                  "This server has no Economy module — costs and the /convert flow will be inactive. Install Economy when creating a server (or rebuild the datapack) to unlock them.",
                )}
              </p>
            )}
            {commands.length > 0 && (
              <div className="space-y-1.5">
                {commands.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">
                        <code className="font-mono text-primary">/trigger {c.id}</code>
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {c.description} · {c.actions.length} action{c.actions.length > 1 ? "s" : ""}
                        {c.costCoins ? ` · ${c.costCoins} coins` : ""}
                        {c.cooldownSeconds ? ` · ${c.cooldownSeconds}s cooldown` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-muted-foreground transition-colors hover:text-destructive"
                      onClick={() => setCommands((prev) => prev.filter((x) => x.id !== c.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="gradient" onClick={() => void installCommands()} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t("Install datapack") + ` (${commands.length})`}
              </Button>
              <Button size="sm" variant="outline" onClick={addDraft}>
                <Plus className="h-3.5 w-3.5" />
                {t("Design a command")}
              </Button>
            </div>

            {draft && (
              <CommandDraftEditor
                draft={draft}
                onChange={setDraft}
                hasEconomy={hasEconomy}
                onCancel={() => setDraft(null)}
                onSave={saveDraft}
              />
            )}
          </div>
        )}

        {tab === "currency" && (
          <div className="space-y-4">
            {!currency ? (
              <Button
                size="sm"
                variant="gradient"
                onClick={() =>
                  setCurrency({
                    name: `${server.name} Coin`,
                    symbol: "VXC",
                    maxSupply: 1000000,
                    dilution: 100000,
                    referenceUsd: 0.01,
                  })
                }
              >
                <Coins className="h-3.5 w-3.5" />
                {t("Design my currency")}
              </Button>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{t("Currency name")}</Label>
                    <Input value={currency.name} onChange={(e) => setCurrency({ ...currency, name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("Symbol")}</Label>
                    <Input
                      value={currency.symbol}
                      maxLength={5}
                      onChange={(e) => setCurrency({ ...currency, symbol: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("Maximum supply (tokens)")}</Label>
                    <Input
                      type="number"
                      min={1}
                      value={currency.maxSupply}
                      onChange={(e) => setCurrency({ ...currency, maxSupply: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("Dilution factor")}</Label>
                    <Input
                      type="number"
                      min={1}
                      value={currency.dilution}
                      onChange={(e) => setCurrency({ ...currency, dilution: Number(e.target.value) || 1 })}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {t("higher = value falls slower. At the factor, each token is worth half the launch value.")}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("Reference value at launch (USD)")}</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.001}
                      value={currency.referenceUsd}
                      onChange={(e) => setCurrency({ ...currency, referenceUsd: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("Mint tokens (recorded on the chain)")}</Label>
                    <div className="flex gap-2">
                      <Input type="number" min={1} value={mintAmount} onChange={(e) => setMintAmount(e.target.value)} />
                      <Button size="sm" variant="outline" onClick={() => void mintSupply()} disabled={busy}>
                        {t("Mint")}
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="gradient" onClick={() => void saveTheCurrency()} disabled={busy}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {t("Save currency")}
                  </Button>
                </div>
                {valuation && (
                  <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <p className="text-xs font-semibold">
                      {t("Real economics, live")} — {valuation.circulating.toLocaleString()}{" "}
                      {currency.symbol} {t("circulating")}
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md border border-border/60 bg-card/60 px-2 py-2">
                        <p className="text-[10px] text-muted-foreground">USD</p>
                        <p className="font-mono text-sm text-primary">${valuation.valueUsd.toFixed(4)}</p>
                      </div>
                      <div className="rounded-md border border-border/60 bg-card/60 px-2 py-2">
                        <p className="text-[10px] text-muted-foreground">BRL</p>
                        <p className="font-mono text-sm text-primary">
                          {valuation.fx ? `R$ ${valuation.valueBrl.toFixed(4)}` : "—"}
                        </p>
                      </div>
                      <div className="rounded-md border border-border/60 bg-card/60 px-2 py-2">
                        <p className="text-[10px] text-muted-foreground">EUR</p>
                        <p className="font-mono text-sm text-primary">
                          {valuation.fx ? `€ ${valuation.valueEur.toFixed(4)}` : "—"}
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      {valuation.fx
                        ? t(`ECB rates of ${valuation.fx.rateDate} (USD→BRL ${valuation.fx.usdBrl.toFixed(4)}, USD→EUR ${valuation.fx.usdEur.toFixed(4)}) — converted automatically.`)
                        : t("FX offline — showing USD only. Rates load from the European Central Bank when online.")}
                    </p>
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      {t(
                        "In-game currency with real-economics behavior. It has no monetary value, cannot be cashed out, and is not a cryptocurrency.",
                      )}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === "dossier" && (
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t(
                "The complete documentation of THIS server — versions, every command with what it does, areas, economy, operations manual and appendices — 30+ pages of facts read from the server's own files, in six reading formats.",
              )}
            </p>
            <Button size="sm" variant="gradient" onClick={() => void generateDossier()} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
              {dossier ? t("Regenerate dossier") : t("Generate dossier")}
            </Button>
            {dossier && (
              <div className="space-y-2">
                <p className="text-xs font-semibold">
                  {t("Pages") + `: ${dossier.pages}` + " · " + dossier.files.length + " formats"}
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {dossier.files.map((f) => (
                    <button
                      key={f.format}
                      type="button"
                      onClick={() => void saveDossierFile(f.format, f.path)}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-xs transition-colors hover:border-primary/40"
                    >
                      <span className="font-semibold uppercase">{f.format}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {(f.bytes / 1024).toFixed(0)} KB
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t("Click a format to save it anywhere (the .md/.txt/.html/.pdf/.docx/.odt also live in the server's Dossier folder).")}
                </p>
              </div>
            )}
          </div>
        )}

        {tab === "ai" && (
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t(
                "You give the command — the AI designs everything else: structures (mines, prisons, towers...), custom commands, world rules. Everything below is a REAL plan with REAL previews; nothing lands until you install it.",
              )}
            </p>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={3}
              placeholder={t(
                'e.g. "Build a prison server: a prison block with 4 cells, a coal mine for rank A, an iron mine for rank B and a diamond mine for rank C, plus a /warp_prison command that teleports and greets"',
              )}
              className="w-full resize-none rounded-lg border border-input bg-background/60 px-3 py-2.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button size="sm" variant="gradient" onClick={() => void designWithAi()} disabled={aiBusy || !aiPrompt.trim()}>
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {aiBusy ? t("Designing…") : t("Design with AI")}
            </Button>

            {plan && (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="text-[11px] leading-relaxed text-foreground/90">
                  <span className="font-semibold">{t("The plan")} — </span>
                  {plan.summary}
                </p>

                {plan.structures.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold">
                      {t("Structures")} · {plan.structures.length}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {plan.structures.map((structure) => (
                        <div key={structure.id} className="rounded-lg border border-border/60 bg-card/60 p-2">
                          <p className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                            <span className="truncate">{structure.id}</span>
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase text-primary">
                              {structure.kind}
                            </span>
                          </p>
                          {structure.purpose && (
                            <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{structure.purpose}</p>
                          )}
                          {planPreviews[structure.id] ? (
                            <IsoStructureCanvas
                              blocks={planPreviews[structure.id]!.blocks}
                              size={planPreviews[structure.id]!.size}
                            />
                          ) : (
                            <div className="flex h-24 items-center justify-center text-[10px] text-muted-foreground">
                              {t("preview unavailable")}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {plan.commands.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold">
                      {t("Commands")} · {plan.commands.length}
                    </p>
                    {plan.commands.map((c) => (
                      <div key={c.id} className="rounded-lg border border-border/60 bg-card/60 px-3 py-2">
                        <p className="text-[11px] font-semibold">
                          <code className="font-mono text-primary">/trigger {c.id}</code>
                          {c.description ? ` — ${c.description}` : ""}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {c.actions.length} action{c.actions.length > 1 ? "s" : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {Object.keys(plan.properties).length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold">{t("World rules")}</p>
                    {Object.entries(plan.properties).map(([k, v]) => (
                      <p key={k} className="text-[10px] text-muted-foreground">
                        <code className="font-mono">{k}</code> = {v}
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button size="sm" variant="gradient" onClick={() => void installPlan()} disabled={busy}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {t("Install everything on this server")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPlan(null); setPlanPreviews({}); }}>
                    {t("Discard plan")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "plugins" && (
          <div className="space-y-3">
            {!isPaper ? (
              <p className="rounded-lg border border-border/70 bg-card/40 px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
                {t(
                  "Plugins are a Paper feature — this server is vanilla. Create a Paper server (same wizard, Software → Paper) and the whole Modrinth plugin catalog opens up here.",
                )}
              </p>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    placeholder={t("Search Paper plugins (Modrinth)…")}
                    value={pluginQuery}
                    onChange={(e) => setPluginQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void searchPlugins()}
                  />
                  <Button size="sm" onClick={() => void searchPlugins()} disabled={pluginBusy}>
                    {pluginBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {t("Search")}
                  </Button>
                </div>
                {pluginHits.length > 0 && (
                  <div className="space-y-1.5">
                    {pluginHits.map((hit) => (
                      <div
                        key={hit.project_id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">{hit.title}</p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {hit.description}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => void installPlugin(hit)} disabled={busy}>
                          {t("Install")}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
