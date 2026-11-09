import { NERDZONE_COMPARISON, VANILLA_LESSONS, VANILLA_LIMITS } from "../data";
import { BugIcon, CheckIcon, HeartIcon, ShieldIcon } from "./Icons";

export function Reference() {
  return (
    <div className="space-y-6">
      <div className="panel overflow-hidden">
        <div className="border-b border-border/60 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            O Rankup de referência e o que o Mine Rank virou
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-semibold">Rankup (referência)</th>
                <th className="px-5 py-3 font-semibold">Mine Rank</th>
                <th className="px-5 py-3 font-semibold">Como ficou</th>
              </tr>
            </thead>
            <tbody>
              {NERDZONE_COMPARISON.map((row) => (
                <tr key={row.nz} className="border-b border-border/40 last:border-0">
                  <td className="px-5 py-3 font-mono text-muted-foreground">{row.nz}</td>
                  <td className="px-5 py-3 font-mono text-primary">{row.mineRank}</td>
                  <td className="px-5 py-3 leading-relaxed text-muted-foreground">
                    {row.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="panel p-5 sm:p-6">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <BugIcon className="h-4 w-4 text-primary" /> O que o teste real provou
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Um datapack parece simples até rodar no servidor de verdade. Estes são os
            comportamentos do vanilla 1.20.1 que só o E2E com cliente real descobriu — e
            que estão registradas como armadilhas para nunca voltarem.
          </p>
          <ul className="mt-4 space-y-2.5">
            {VANILLA_LESSONS.map((lesson) => (
              <li
                key={lesson.title}
                className="rounded-xl border border-border/50 bg-background/40 p-3"
              >
                <p className="text-xs font-semibold text-foreground">{lesson.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {lesson.detail}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel p-5 sm:p-6">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <ShieldIcon className="h-4 w-4 text-primary" /> Os limites honestos
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            O Mine Rank não vende o que o vanilla não faz. Estes são os limites
            assumidos de cara — e todos estão escritos no <code className="font-mono">COMMANDS.md</code>{" "}
            que vai junto do datapack.
          </p>
          <ul className="mt-4 space-y-2.5">
            {VANILLA_LIMITS.map((limit) => (
              <li key={limit} className="flex gap-2.5 text-xs leading-relaxed text-muted-foreground">
                <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span>{limit}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function Dedication() {
  return (
    <div className="panel relative overflow-hidden p-6 sm:p-10">
      <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/12 blur-3xl" />
      <div className="relative grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-rose-400/25 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-300">
            <HeartIcon className="h-3.5 w-3.5" /> Dedicatória
          </p>
          <h3 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
            Ao <span className="text-rose-300">NerdZone.gg</span>, que inspires o
            estilo Rankup
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            O Mine Rank nasceu de uma referência real: o Rankup público do{" "}
            <a
              href="https://nerdzone.gg/guia"
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              NerdZone.gg
            </a>
            . O guia do servidor mostrava como uma progressão de mineração pode ser
            simples, clara e divertida — reservar um terreno, cavar a sua mina,
            vender minério, subir de tier. O Mine Rank existe como uma{" "}
            <span className="text-foreground">variação própria</span> dessegue: outra
            economia, outro mundo, outra linguagem de comandos.
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Agradecemos ao time do NerdZone por mostrar o caminho — e a todos os
            servidores de Rankup que mantêm a categoria viva. Nenhum
            código, texto, textura ou marca do NerdZone foi copiado para cá: o
            datapack, o mundo, os comandos e este site são inteiramente originais do
            VOXEL.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="https://nerdzone.gg/guia"
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-border/70 bg-card/50 px-4 py-2.5 text-xs font-semibold text-foreground transition-colors hover:border-rose-400/50"
            >
              O guia do Rankup no NerdZone ↗
            </a>
            <a
              href="https://nerdzone.gg/wiki"
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-border/70 bg-card/50 px-4 py-2.5 text-xs font-semibold text-foreground transition-colors hover:border-rose-400/50"
            >
              A wiki do NerdZone ↗
            </a>
          </div>
        </div>

        <div className="panel-soft p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Nota de independência
          </p>
          <ul className="mt-4 space-y-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <li>
              · O Mine Rank é um projeto independente, mantido pelo time do VOXEL.
            </li>
            <li>
              · VOXEL e Mine Rank não são afiliados, patrocinados ou endossados pelo
              NerdZone.gg ou pela Mojang/Microsoft.
            </li>
            <li>
              · A referência foi usada apenas como <em>inspiração de estilo</em>, a
              partir do material público do servidor.
            </li>
            <li>
              · Todo o código-fonte (datapack, gerador, site) está no repositório
              público do VOXEL no GitHub.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

