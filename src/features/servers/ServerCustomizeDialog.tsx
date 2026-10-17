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
  X,
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
import {
  listBriefingDocuments,
  writeBriefingDocuments,
} from "@/services/documents/documentsService";
import { readProjectFile, writeProjectFile } from "@/services/projects/projectsService";
import {
  generateCustomCommandsDatapack,
  validateTriggerId,
  type CommandAction,
  type CustomCommand,
} from "@/services/servers/customCommands";
import {
  searchModrinthMods,
  getModrinthVersions,
  pickModrinthFile,
  type ModrinthSearchHit,
} from "@/services/modpacks/modrinthService";

type Tab = "briefing" | "world" | "structures" | "commands" | "plugins";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "briefing", label: "Briefing", icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "world", label: "World", icon: <Globe className="h-3.5 w-3.5" /> },
  { id: "structures", label: "Structures", icon: <Boxes className="h-3.5 w-3.5" /> },
  { id: "commands", label: "Commands", icon: <MessageSquareCode className="h-3.5 w-3.5" /> },
  { id: "plugins", label: "Plugins", icon: <PackagePlus className="h-3.5 w-3.5" /> },
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

  const addDraftAction = (action: CommandAction) => {
    if (!draft) return;
    setDraft({ ...draft, actions: [...draft.actions, action] });
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
              <div className="space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[10px]">{t("Command id")}</Label>
                    <Input
                      placeholder="vip_kit"
                      className="h-8 text-xs"
                      value={draft.id}
                      onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">{t("What it does")}</Label>
                    <Input
                      placeholder="The VIP welcome kit"
                      className="h-8 text-xs"
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">{t("Cost in coins (0 = free)")}</Label>
                    <Input
                      type="number"
                      min={0}
                      className="h-8 text-xs"
                      value={draft.costCoins ?? 0}
                      onChange={(e) => setDraft({ ...draft, costCoins: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">{t("Cooldown seconds")}</Label>
                    <Input
                      type="number"
                      min={0}
                      className="h-8 text-xs"
                      value={draft.cooldownSeconds ?? 0}
                      onChange={(e) =>
                        setDraft({ ...draft, cooldownSeconds: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => addDraftAction({ kind: "message", text: "Welcome!", color: "green" })}>
                    + message
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => addDraftAction({ kind: "title", text: "ARENA" })}>
                    + title
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => addDraftAction({ kind: "give", item: "diamond", count: 1 })}>
                    + give
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => addDraftAction({ kind: "teleport", x: 0, y: 64, z: 0 })}>
                    + teleport
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => addDraftAction({ kind: "effect", effect: "speed", seconds: 30, amplifier: 1 })}>
                    + effect
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => addDraftAction({ kind: "sound", sound: "entity.player.levelup" })}>
                    + sound
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      addDraftAction({
                        kind: "summon",
                        mob: "zombie",
                        name: "Arena Guardian",
                        health: 40,
                        heldItem: "iron_sword",
                        helmet: "diamond_helmet",
                      })
                    }
                  >
                    + mob
                  </Button>
                  {hasEconomy && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => addDraftAction({ kind: "convert", tiers: [50, 100, 250] })}
                    >
                      + /convert
                    </Button>
                  )}
                </div>
                {draft.actions.length > 0 && (
                  <div className="space-y-1">
                    {draft.actions.map((a, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/60 px-2 py-1 text-[10px]"
                      >
                        <code className="truncate font-mono text-muted-foreground">
                          {a.kind === "message" && `message "${a.text}"`}
                          {a.kind === "title" && `title "${a.text}"`}
                          {a.kind === "give" && `give ${a.item} x${a.count ?? 1}`}
                          {a.kind === "teleport" && `tp ${a.x} ${a.y} ${a.z}`}
                          {a.kind === "effect" && `effect ${a.effect} ${a.seconds}s`}
                          {a.kind === "sound" && `sound ${a.sound}`}
                          {a.kind === "summon" && `summon ${a.mob} "${a.name ?? ""}"`}
                          {a.kind === "convert" && `convert tiers ${a.tiers.join("/")}`}
                        </code>
                        <button
                          type="button"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            setDraft({ ...draft, actions: draft.actions.filter((_, j) => j !== i) })
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                    {t("Cancel")}
                  </Button>
                  <Button size="sm" variant="gradient" onClick={saveDraft}>
                    {t("Add command")}
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
