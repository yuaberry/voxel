import {
  MINE_RANK_COMMANDS,
  MINE_RANK_MINE_RESET_COST,
  MINE_RANK_TIERS,
  PROOFS,
} from "../data";
import { ArrowIcon, CubeIcon, PickaxeIcon, SparkIcon, TerminalIcon } from "./Icons";
import { StatCard } from "./ui";

/**
 * The REAL transcript of the module — line by line what the vanilla server
 * prints when the player types the command (the display name of a trigger
 * objective is the command description, capped at 32 chars, exactly like the
 * datapack registers it).
 */
const CONSOLE_LINES = [
  { kind: "cmd", text: "/trigger mr_t_mine set 1" },
  { kind: "out", text: "Triggered [Abre o menu da sua mina.] (set value to 1)" },
  { kind: "mine", text: "[Mine Rank] Sua mina" },
  { kind: "out", text: " 1. Ir para a mina" },
  { kind: "out", text: ` 2. Restaurar os blocos (${MINE_RANK_MINE_RESET_COST} coins)` },
];

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-lines" />
      <div className="shell relative pb-16 pt-14 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <SparkIcon className="h-3.5 w-3.5 text-primary" />
              VOXEL · módulo de servidor
            </p>

            <h1 className="mt-6 text-5xl font-black leading-[0.95] tracking-tight sm:text-7xl">
              MINE
              <br />
              <span className="brand-text">RANK</span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Um <span className="text-foreground">Rankup de verdade</span> em{" "}
              <span className="text-foreground">datapack vanilla</span> — sem plugin,
              sem dependência, sem fake data. {MINE_RANK_COMMANDS.length} comandos,
              {MINE_RANK_TIERS.length} tiers, prestígio, 8 minas privadas, 4 moedas,
              clans, pesca e arena — tudo testado num servidor Minecraft 1.20.1 de
              verdade.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#comandos"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-bar px-5 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
              >
                Ver os {MINE_RANK_COMMANDS.length} comandos
                <ArrowIcon className="h-4 w-4" />
              </a>
              <a
                href="#dedicatoria"
                className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card/50 px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50"
              >
                <CubeIcon className="h-4 w-4 text-primary" />
                A referência e a dedicatória
              </a>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="chip">
                <PickaxeIcon className="h-3 w-3" /> datapack <code className="font-mono">nexus_rank</code>
              </span>
              <span className="chip">Minecraft 1.20.1 · pack format 15</span>
              <span className="chip">só /trigger + menus clicáveis</span>
            </div>
          </div>

          {/* the real terminal of the real module */}
          <div className="relative">
            <div className="panel overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border/60 bg-background/50 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
                <span className="ml-2 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <TerminalIcon className="h-3 w-3" /> servidor 1.20.1 · E2E real
                </span>
              </div>
              <div className="space-y-1.5 p-4 font-mono text-[12px] leading-relaxed">
                {CONSOLE_LINES.map((line, index) => (
                  <p
                    key={line.text}
                    className="animate-card-rise"
                    style={{ animationDelay: `${index * 140}ms` }}
                  >
                    {line.kind === "cmd" ? (
                      <span className="text-primary">❯ {line.text}</span>
                    ) : line.kind === "mine" ? (
                      <span className="text-cyan-300">{line.text}</span>
                    ) : line.kind === "ok" ? (
                      <span className="text-emerald-300">{line.text}</span>
                    ) : (
                      <span className="text-muted-foreground">{line.text}</span>
                    )}
                  </p>
                ))}
                <p className="text-primary">
                  ▌<span className="inline-block h-4 w-2 animate-pulse bg-primary/80 align-middle" />
                </p>
              </div>
              <p className="border-t border-border/60 bg-background/40 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                Transcrição literal do servidor: cada bloco minerado vale{" "}
                <span className="text-foreground">1 level + 1 coin</span> (+1 coin por
                prestígio).
              </p>
            </div>
            <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-primary/10 blur-3xl" />
          </div>
        </div>

        <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {PROOFS.map((proof, index) => (
            <div key={proof.label} style={{ animationDelay: `${index * 60}ms` }}>
              <StatCard value={proof.value} label={proof.label} hint={proof.hint} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
