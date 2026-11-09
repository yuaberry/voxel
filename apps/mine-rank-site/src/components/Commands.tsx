import { useMemo, useState } from "react";
import {
  FAMILY_ORDER,
  MINE_RANK_COMMANDS,
  MINE_RANK_FAMILY_LABELS,
  type MineRankFamily,
} from "../data";
import { Chip } from "./ui";

const SURFACE_LABEL: Record<string, string> = {
  menu: "menu",
  info: "informação",
  warp: "teleporte",
  action: "ação",
  economy: "economia",
  social: "social",
};

export function Commands() {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<MineRankFamily | "todas">("todas");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return MINE_RANK_COMMANDS.filter((command) => {
      if (family !== "todas" && command.family !== family) return false;
      if (!needle) return true;
      return (
        command.id.toLowerCase().includes(needle) ||
        command.description.toLowerCase().includes(needle) ||
        command.trigger.toLowerCase().includes(needle) ||
        (command.note ?? "").toLowerCase().includes(needle)
      );
    });
  }, [query, family]);

  const countFor = (target: MineRankFamily | "todas") =>
    target === "todas"
      ? MINE_RANK_COMMANDS.length
      : MINE_RANK_COMMANDS.filter((command) => command.family === target).length;

  return (
    <div>
      <div className="panel p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar comando, descrição ou trigger…"
              aria-label="Buscar comando"
              className="w-full rounded-lg border border-border/70 bg-background/60 px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {filtered.length} de {MINE_RANK_COMMANDS.length} comandos
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Chip active={family === "todas"} onClick={() => setFamily("todas")}>
            Todas <span className="opacity-60">{countFor("todas")}</span>
          </Chip>
          {FAMILY_ORDER.map((item) => (
            <Chip key={item} active={family === item} onClick={() => setFamily(item)}>
              {MINE_RANK_FAMILY_LABELS[item]}{" "}
              <span className="opacity-60">{countFor(item)}</span>
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {filtered.map((command, index) => (
          <article
            key={command.trigger}
            className="panel-soft animate-card-rise p-3.5 transition-colors hover:border-primary/40"
            style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md bg-primary/12 px-2 py-0.5 font-mono text-[12px] font-semibold text-primary">
                {command.id}
              </code>
              <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {SURFACE_LABEL[command.surface] ?? command.surface}
              </span>
              {command.args.length > 0 ? (
                <span className="font-mono text-[10px] text-muted-foreground/80">
                  {command.args.join(" ")}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-foreground/90">
              {command.description}
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
              <span className="text-cyan-300/90">/trigger {command.trigger}</span>
              {command.note ? <span>· {command.note}</span> : null}
            </p>
          </article>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="panel-soft mt-4 p-6 text-center text-sm text-muted-foreground">
          Nada encontrado para “{query}”. Tente <code className="font-mono">mina</code>,{" "}
          <code className="font-mono">prestigio</code> ou{" "}
          <code className="font-mono">clan</code>.
        </p>
      ) : null}
    </div>
  );
}
