/**
 * The loader picker — Fabric, Forge and NeoForge, so the owner can install
 * mods, shaders, modpacks and texture packs on a version he picked.
 *
 * The catalog comes from Rust (the official meta/maven endpoints), and an
 * installer-backed loader is installed by running the loader's OWN installer
 * with `--installClient` — nothing is reimplemented here. After the install
 * the row becomes a "Jogar" button that launches that loader directly.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Blocks, Loader2, Package, Play } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";
import { launchGame } from "@/services/launcher/instanceService";
import { getStoredAccount } from "@/services/launcher/accountService";
import { vanillaInstanceSlug } from "@/services/launcher/versionsService";

export interface LoaderEntry {
  loader: string;
  version: string;
  target: string;
  installerUrl: string;
  installed: boolean;
  channel: string;
}

export function LoaderPicker({ mcVersion }: { mcVersion: string }) {
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const javaPath = useSettingsStore((s) => s.settings.java.customJavaPath);
  const [loaders, setLoaders] = useState<LoaderEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** the version id the game is launched with (a loader renames it) */
  const [launchVersion, setLaunchVersion] = useState<Record<string, string>>({});
  /** the version the loaded list belongs to — clearing it derives from the prop */
  const [shown, setShown] = useState(mcVersion);
  if (shown !== mcVersion) {
    setShown(mcVersion);
    setLoaders(null);
  }

  useEffect(() => {
    if (!basePath || !mcVersion) return;
    let alive = true;
    invoke<{ java: LoaderEntry[]; mcVersion: string }>("launcher_loader_catalog", {
      basePath,
      mcVersion,
    })
      .then((catalog) => {
        if (alive) setLoaders(catalog.java);
      })
      .catch((error) => {
        toast.error("Não foi possível ler os inicializadores", {
          description: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      alive = false;
    };
  }, [basePath, mcVersion]);

  const rows = useMemo(() => {
    // the loaders in the order a modder picks them: recommended Forge/Fabric
    // first, then NeoForge, then everything else
    const score = (entry: LoaderEntry) =>
      entry.loader === "Fabric" ? 0 : entry.channel === "recomendado" ? 1 : entry.loader === "NeoForge" ? 2 : 3;
    return [...(loaders ?? [])].sort((a, b) => score(a) - score(b));
  }, [loaders]);

  const install = useCallback(
    async (entry: LoaderEntry) => {
      if (!basePath) return;
      setBusy(`${entry.loader}-${entry.version}`);
      try {
        const result = await invoke<{ instanceSlug: string; targetVersion: string }>(
          "launcher_install_loader",
          {
            basePath,
            mcVersion,
            loader: entry.loader,
            loaderVersion: entry.version,
            javaPath: javaPath ?? null,
          },
        );
        setLaunchVersion((current) => ({ ...current, [entry.target]: result.targetVersion }));
        toast.success(`${entry.loader} ${entry.version} instalado`, {
          description: "Agora é só clicar em Jogar.",
        });
        setLoaders((current) =>
          (current ?? []).map((row) =>
            row.target === entry.target ? { ...row, installed: true } : row,
          ),
        );
      } catch (error) {
        toast.error(`Falha ao instalar o ${entry.loader}`, {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusy(null);
      }
    },
    [basePath, javaPath, mcVersion],
  );

  const play = useCallback(
    async (entry: LoaderEntry) => {
      if (!basePath) return;
      setBusy(`${entry.loader}-${entry.version}`);
      try {
        const account = await getStoredAccount().catch(() => null);
        if (!account) {
          toast.error("Conecte uma conta primeiro", {
            description: "Ajustes → Launcher: Ely.by ou Microsoft.",
          });
          return;
        }
        const version = launchVersion[entry.target] ?? entry.target;
        await launchGame({
          basePath,
          projectSlug: vanillaInstanceSlug(`${entry.loader.toLowerCase()}-${version}`),
          mcVersion: version,
          // Fabric is launched by the vanilla path with its profile; Forge and
          // NeoForge install their own version id, which is what we launch
          loader: entry.loader === "Fabric" ? "fabric" : "vanilla",
          account,
          ramMb: undefined,
        });
      } catch (error) {
        toast.error("Falha ao abrir o jogo", {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusy(null);
      }
    },
    [basePath, launchVersion],
  );

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Blocks className="h-3 w-3" /> Inicializadores — mods, shaders e modpacks
      </p>
      {rows.length === 0 && loaders ? (
        <p className="rounded-lg border border-border/50 bg-card/40 p-3 text-[11px] text-muted-foreground">
          Nenhum inicializador publicado para o Minecraft {mcVersion} ainda.
        </p>
      ) : null}
      <div className="space-y-1.5">
        {rows.map((entry) => (
          <div
            key={`${entry.loader}-${entry.version}`}
            className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-card/40 px-2.5 py-1.5"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                <Package className="h-3 w-3 text-muted-foreground" />
                {entry.loader} {entry.version}
                <Badge variant={entry.channel === "recomendado" ? "success" : "secondary"} className="text-[9px]">
                  {entry.channel}
                </Badge>
                {entry.installed ? (
                  <Badge variant="outline" className="text-[9px]">
                    instalado
                  </Badge>
                ) : null}
              </p>
            </div>
            <Button
              size="sm"
              variant={entry.installed ? "outline" : "gradient"}
              disabled={busy !== null}
              onClick={() => void (entry.installed ? play(entry) : install(entry))}
            >
              {busy === `${entry.loader}-${entry.version}` ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : entry.installed ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Package className="h-3.5 w-3.5" />
              )}
              {entry.installed ? "Jogar" : "Instalar"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}