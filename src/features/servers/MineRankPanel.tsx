import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Coins,
  Download,
  Gem,
  Globe,
  Info,
  Loader2,
  Map as MapIcon,
  Pickaxe,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  MINE_RANK_COMMANDS,
  MINE_RANK_CURRENCIES,
  MINE_RANK_FAMILY_LABELS,
  MINE_RANK_NS,
  MINE_RANK_PLOTS,
  MINE_RANK_PRESTIGE_LEVEL,
  MINE_RANK_TIERS,
  generateMineRankFiles,
  type MineRankFamily,
} from "@/services/servers/mineRankServer";
import { readProjectFile, writeProjectFile, writeProjectFileBase64 } from "@/services/projects/projectsService";
import { sendServerCommand } from "@/services/servers/serverService";
import type { ServerRecord } from "@/types";

interface Props {
  server: ServerRecord;
  basePath: string;
  running: boolean;
}

/** The attribution that travels inside the imported world. */
interface MapCredits {
  title: string;
  author: string;
  license: string;
  sourceUrl: string;
}

const EMPTY_CREDITS: MapCredits = {
  title: "",
  author: "",
  license: "",
  sourceUrl: "",
};

const FAMILY_ORDER: MineRankFamily[] = [
  "mina",
  "progressao",
  "terrenos",
  "economia",
  "sistemas",
  "social",
  "geral",
];

/**
 * Mine Rank — the panel that shows (and installs) the Rankup-style module:
 * the tiers, the four coins, every command the server answers and the honest
 * vanilla limits behind them.
 */
export function MineRankPanel({ server, basePath, running }: Props) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [openFamily, setOpenFamily] = useState<MineRankFamily>("mina");
  const [credits, setCredits] = useState<MapCredits>(EMPTY_CREDITS);
  const [mapCredits, setMapCredits] = useState<MapCredits | null>(null);

  const slug = server.slug;

  const checkInstalled = useCallback(async () => {
    const marker = await readProjectFile(
      basePath,
      `servers/${slug}/world/datapacks/${MINE_RANK_NS}/pack.mcmeta`,
    ).catch(() => null);
    setInstalled(marker !== null);
  }, [basePath, slug]);

  const readMapCredits = useCallback(async () => {
    const raw = await readProjectFile(
      basePath,
      `servers/${slug}/world/voxel-map-credits.json`,
    ).catch(() => null);
    if (!raw) {
      setMapCredits(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<MapCredits>;
      setMapCredits({
        title: parsed.title ?? "",
        author: parsed.author ?? "",
        license: parsed.license ?? "",
        sourceUrl: parsed.sourceUrl ?? "",
      });
    } catch {
      setMapCredits(null);
    }
  }, [basePath, slug]);

  useEffect(() => {
    void Promise.resolve().then(() => checkInstalled());
    void Promise.resolve().then(() => readMapCredits());
  }, [checkInstalled, readMapCredits]);

  const commandsByFamily = useMemo(() => {
    const grouped = new Map<MineRankFamily, typeof MINE_RANK_COMMANDS>();
    for (const family of FAMILY_ORDER) {
      grouped.set(
        family,
        MINE_RANK_COMMANDS.filter((command) => command.family === family),
      );
    }
    return grouped;
  }, []);

  const handleInstall = async () => {
    setBusy(true);
    try {
      const files = generateMineRankFiles();
      for (const file of files) {
        const rel = `servers/${slug}/${file.path}`;
        if (file.base64) {
          await writeProjectFileBase64(basePath, rel, file.base64);
        } else {
          await writeProjectFile(basePath, rel, file.content);
        }
      }
      setInstalled(true);
      toast.success("Mine Rank instalado", {
        description: `${files.length} arquivos · datapack ${MINE_RANK_NS}`,
      });
      if (running) {
        await sendServerCommand(slug, "reload").catch(() => {});
        toast.info("reload enviado ao servidor", {
          description: "O datapack já entra em vigor sem reiniciar.",
        });
      } else {
        toast.info("Inicie o servidor para ativar o datapack.");
      }
    } catch (error) {
      toast.error("Falha ao instalar o Mine Rank", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Imports a world map (a ZIP downloaded by the owner) with its
   * attribution. The app NEVER downloads a third-party map by itself: the
   * license of a community map has to travel with the files, so the credits
   * are written inside the world.
   */
  const handleImportMap = async () => {
    if (busy) return;
    if (!credits.title.trim()) {
      toast.error("O mapa precisa de um nome", {
        description: "A atribuição (autor e licença) vai junto com o mundo.",
      });
      return;
    }
    const picked = await openFileDialog({
      multiple: false,
      title: "Importar mapa do mundo (.zip)",
      filters: [{ name: "Mapa do mundo", extensions: ["zip"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    setBusy(true);
    try {
      const message = await invoke<string>("server_import_world", {
        basePath,
        slug,
        zipPath: picked,
        credits: {
          title: credits.title.trim(),
          author: credits.author.trim(),
          license: credits.license.trim(),
          sourceUrl: credits.sourceUrl.trim(),
        },
      });
      toast.success("Mapa importado", { description: message, duration: 12000 });
      await readMapCredits();
    } catch (error) {
      toast.error("Falha ao importar o mapa", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-start gap-3 rounded-lg border border-border/70 bg-gradient-to-br from-primary/15 via-card/60 to-transparent p-3">
        <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
          <Pickaxe className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span>Mine Rank</span>
            <Badge variant={installed ? "success" : "secondary"}>
              {installed === null ? "verificando…" : installed ? "instalado" : "não instalado"}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Progressão estilo Rankup escrita pelo VOXEL: {MINE_RANK_COMMANDS.length} comandos,
            {MINE_RANK_TIERS.length} tiers, prestígio no level {MINE_RANK_PRESTIGE_LEVEL},{" "}
            {MINE_RANK_PLOTS} terrenos com 8 camadas de minério e 4 moedas — 100% vanilla 1.20.1,
            sem plugin.
          </p>
        </div>
        <Button size="sm" variant={installed ? "outline" : "gradient"} onClick={() => void handleInstall()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {installed ? "Atualizar" : "Instalar"}
        </Button>
      </div>

      {/* tiers */}
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3 w-3" /> Tiers
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {MINE_RANK_TIERS.map((tier) => (
            <div
              key={tier.index}
              className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-card/40 px-2.5 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: tier.color }}
                />
                <span className="truncate text-[11px] font-medium">{tier.name}</span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                lv {tier.minLevel}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* currencies */}
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Coins className="h-3 w-3" /> Moedas
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {MINE_RANK_CURRENCIES.map((currency) => (
            <div
              key={currency.id}
              className="rounded-md border border-border/50 bg-card/40 px-2.5 py-1.5"
            >
              <p className="flex items-center gap-1.5 text-[11px] font-medium">
                <span style={{ color: currency.color }}>{currency.symbol}</span>
                {currency.name}
              </p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                {currency.earns}
              </p>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* world map */}
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <MapIcon className="h-3 w-3" /> Mapa do mundo
        </p>

        {mapCredits ? (
          <div className="rounded-lg border border-success/30 bg-success/5 p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold">
              <Globe className="h-3 w-3 text-success" />
              {mapCredits.title || "Mapa importado"}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              {mapCredits.author ? `por ${mapCredits.author}` : "sem autor informado"}
              {mapCredits.license ? ` · ${mapCredits.license}` : ""}
            </p>
            {mapCredits.sourceUrl ? (
              <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/70">
                {mapCredits.sourceUrl}
              </p>
            ) : null}
            <p className="mt-1 text-[9px] text-muted-foreground/70">
              A atribuição está gravada dentro do mundo (VOXEL_MAP_CREDITS.md).
            </p>
          </div>
        ) : (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            O VOXEL nunca baixa o mapa de um site sozinho: o dono escolhe o ZIP
            (de um mapa comunitário, por exemplo) e a licença do mapa é gravada
            dentro do mundo. Sem mapa importado, o servidor usa o mundo gerado
            pelo próprio Mine Rank (hub, terrenos, lago e arena).
          </p>
        )}

        <div className="grid gap-1.5 sm:grid-cols-2">
          <Input
            value={credits.title}
            onChange={(event) => setCredits({ ...credits, title: event.target.value })}
            placeholder="Nome do mapa (obrigatório)"
            className="h-7 text-[11px]"
          />
          <Input
            value={credits.author}
            onChange={(event) => setCredits({ ...credits, author: event.target.value })}
            placeholder="Autor"
            className="h-7 text-[11px]"
          />
          <Input
            value={credits.license}
            onChange={(event) => setCredits({ ...credits, license: event.target.value })}
            placeholder="Licença (ex.: CC BY-SA 4.0)"
            className="h-7 text-[11px]"
          />
          <Input
            value={credits.sourceUrl}
            onChange={(event) => setCredits({ ...credits, sourceUrl: event.target.value })}
            placeholder="Link de origem"
            className="h-7 text-[11px]"
          />
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleImportMap()}
          disabled={busy || running}
          title={running ? "Pare o servidor para importar um mundo" : undefined}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapIcon className="h-3.5 w-3.5" />}
          Importar mapa (.zip)
        </Button>
        <p className="text-[9px] leading-relaxed text-muted-foreground/70">
          O mundo atual é guardado de lado (nada é destruído) e o datapack do
          Mine Rank precisa ser reinstalado depois da importação.
        </p>
      </div>

      <Separator />

      {/* commands */}
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <ScrollText className="h-3 w-3" /> Comandos
        </p>
        <div className="flex flex-wrap gap-1">
          {FAMILY_ORDER.map((family) => (
            <button
              key={family}
              type="button"
              onClick={() => setOpenFamily(family)}
              className={
                "rounded-md px-2 py-1 text-[10px] font-medium transition-colors " +
                (openFamily === family
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {MINE_RANK_FAMILY_LABELS[family]}
              <span className="ml-1 opacity-60">{commandsByFamily.get(family)?.length ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border/60 bg-background/50 p-2">
          {(commandsByFamily.get(openFamily) ?? []).map((command) => (
            <div key={command.trigger} className="rounded-md px-1.5 py-1 hover:bg-secondary/40">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <code className="font-mono text-[10px] text-primary">{command.id}</code>
                <span className="text-[10px] text-muted-foreground">{command.description}</span>
              </p>
              <p className="mt-0.5 font-mono text-[9px] text-muted-foreground/70">
                /trigger {command.trigger}
                {command.note ? ` · ${command.note}` : ""}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* honest limits */}
      <div className="space-y-1.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-warning">
          <ShieldCheck className="h-3.5 w-3.5" /> Limites honestos do vanilla
        </p>
        <ul className="space-y-1 text-[10px] leading-relaxed text-muted-foreground">
          <li>· O único comando de jogador é /trigger — por isso cada comando tem um número.</li>
          <li>· Não existe texto livre: chat, clans e pedidos usam menus e frases prontas.</li>
          <li>· Não dá para digitar um nick: o alvo dos comandos sociais é o jogador mais próximo.</li>
          <li>· O ranking de jogadores não existe no vanilla — o painel mostra os totais reais do servidor.</li>
        </ul>
        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground/80">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          O datapack traz um <span className="font-mono">COMMANDS.md</span> com a lista completa e a
          comparação com o Rankup de referência (nerdzone.gg).
        </p>
      </div>

      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
        <Gem className="h-3 w-3" />
        Inspirado no estilo Rankup público do NerdZone — código, comandos e mundo são originais do
        VOXEL.
      </p>
    </div>
  );
}
