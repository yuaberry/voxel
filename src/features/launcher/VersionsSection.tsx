/**
 * The "download a version" section of the Launcher.
 *
 * The owner asked for it plainly: "quero que adicione ao Mine Rank a opção
 * de Minecraft Bedrock e Java para download direto do Voxel, só com conta,
 * Ely.By também vale".
 *
 * Java Edition is downloadable and playable here, with the same account the
 * rest of the launcher uses (Ely.by or Microsoft — the account is the only
 * credential, no password is stored). Bedrock is a different story and the
 * card says so instead of offering a button that cannot work on Linux.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, MonitorPlay, Package, Play, Sparkles } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useSettingsStore } from "@/stores/settingsStore";
import { launchGame, prepareInstance } from "@/services/launcher/instanceService";
import {
  listVersionCatalog,
  vanillaInstanceSlug,
  versionKindLabel,
  versionReleased,
  type VersionCatalogEntry,
} from "@/services/launcher/versionsService";
import { getStoredAccount } from "@/services/launcher/accountService";
import { LoaderPicker } from "@/features/launcher/LoaderPicker";

/** How many versions the list shows before a search narrows it. */
const VISIBLE_WITHOUT_SEARCH = 24;

/** A short label for the era of a version — what the owner reads first. */
function versionTitle(id: string): string {
  if (id.startsWith("rd-")) return "Minecraft Clássico";
  if (id.startsWith("a") || id.startsWith("inf-")) return "Minecraft Alpha";
  if (id.startsWith("b")) return "Minecraft Beta";
  return `Minecraft Java`;
}

export function VersionsSection() {
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof listVersionCatalog>> | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  /** the version whose loaders the owner is looking at */
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!basePath) return;
    let alive = true;
    listVersionCatalog(basePath)
      .then((entries) => {
        if (alive) setCatalog(entries);
      })
      .catch((error) => {
        toast.error("Não foi possível ler o catálogo de versões", {
          description: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      alive = false;
    };
  }, [basePath]);

  const versions = useMemo(() => {
    const list = catalog?.java ?? [];
    const term = query.trim().toLowerCase();
    if (!term) return list.slice(0, VISIBLE_WITHOUT_SEARCH);
    return list.filter((entry) => entry.id.toLowerCase().includes(term)).slice(0, 60);
  }, [catalog, query]);

  /** Downloads the official runtime and hands the game over to the account. */
  const downloadAndPlay = useCallback(
    async (entry: VersionCatalogEntry) => {
      if (!basePath) return;
      setBusyId(entry.id);
      try {
        const account = await getStoredAccount().catch(() => null);
        if (!account) {
          toast.error("Conecte uma conta primeiro", {
            description: "Ajustes → Launcher: Ely.by ou Microsoft. O download começa sozinho depois.",
          });
          return;
        }
        const slug = vanillaInstanceSlug(entry.id);
        await prepareInstance(basePath, slug, entry.id, "vanilla", "");
        // a lista multiplayer do Mine Rank entra na instância vanilla também
        await invoke("multiplayer_write_servers_dat", {
          basePath,
          slug,
          entries: [],
        }).catch(() => {});
        await launchGame({
          basePath,
          projectSlug: slug,
          mcVersion: entry.id,
          loader: "vanilla",
          account,
          ramMb: undefined,
        });
        setCatalog(await listVersionCatalog(basePath));
      } catch (error) {
        toast.error(`Falha ao preparar o Minecraft ${entry.id}`, {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyId(null);
      }
    },
    [basePath],
  );

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Download className="h-3 w-3" /> Baixar uma versão do Minecraft
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar versão (ex.: 1.20.1, 1.21)"
          aria-label="Buscar versão"
          className="h-8 sm:max-w-xs"
        />
        <span className="text-[10px] text-muted-foreground">
          {catalog ? `${catalog.java.length} versões publicadas pela Mojang` : "lendo o catálogo oficial…"}
        </span>
      </div>

      <div className="max-h-72 space-y-1.5 overflow-auto rounded-lg border border-border/50 p-2">
        {versions.map((entry) => (
          <div
            key={entry.id}
            onClick={() => entry.runnable && setSelected(entry.id === selected ? null : entry.id)}
            className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-2 ${
              selected === entry.id
                ? "border-primary/60 bg-primary/5"
                : entry.runnable
                  ? "border-border/40 bg-card/40"
                  : "border-border/25 bg-card/20 opacity-70"
            }`}
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                <MonitorPlay className="h-3 w-3 text-muted-foreground" />
                {/* the version id first: what the owner searches for */}
                <span className="font-mono text-[11px]">Minecraft {entry.id}</span>
                <Badge
                  variant={entry.kind === "release" ? "success" : "secondary"}
                  className="text-[9px]"
                >
                  {versionKindLabel(entry.kind)}
                </Badge>
                <span className="text-[10px] font-normal text-muted-foreground">
                  {versionTitle(entry.id)} · {versionReleased(entry.releaseTime)}
                </span>
                {entry.installed ? (
                  <Badge variant="outline" className="text-[9px]">
                    já baixado
                  </Badge>
                ) : null}
              </p>
              {!entry.runnable ? (
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  {entry.notRunnableReason}
                </p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant={entry.installed ? "outline" : "gradient"}
              disabled={busyId !== null || !entry.runnable}
              title={entry.runnable ? undefined : entry.notRunnableReason}
              onClick={() => void downloadAndPlay(entry)}
            >
              {busyId === entry.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : entry.installed ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {entry.installed ? "Jogar" : "Baixar"}
            </Button>
          </div>
        ))}
        {versions.length === 0 && catalog ? (
          <p className="p-3 text-xs text-muted-foreground">Nenhuma versão corresponde à busca.</p>
        ) : null}
      </div>

      {selected ? (
        <>
          <Separator />
          <LoaderPicker mcVersion={selected} />
        </>
      ) : null}

      <Separator />

      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-warning">
          <Package className="h-3 w-3" /> Bedrock Edition
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {catalog?.bedrock.reason ??
            "Bedrock não é instalável a partir do Linux: ela é publicada como pacote UWP da Microsoft Store e exige o Windows."}
        </p>
        {(catalog?.bedrock.editions ?? []).map((edition) => (
          <p key={edition.name} className="mt-1.5 text-[10px] text-muted-foreground">
            {edition.name} · {edition.platform} ·{" "}
            <a href={edition.url} target="_blank" rel="noreferrer" className="link">
              {edition.url}
            </a>
          </p>
        ))}
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          O servidor Mine Rank é <span className="text-foreground">Java 1.20.1</span> — a versão que o
          VOXEL baixa e roda aqui.
        </p>
      </div>

      <Separator />

      <div className="grid gap-2 sm:grid-cols-2">
        <a
          href="/shaders"
          className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-[11px] transition-colors hover:border-primary/40"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Shaders e packs de textura
        </a>
        <a
          href="/marketplace"
          className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-[11px] transition-colors hover:border-primary/40"
        >
          <Package className="h-3.5 w-3.5 text-primary" />
          Modpacks e mods (Marketplace)
        </a>
      </div>
    </div>
  );
}