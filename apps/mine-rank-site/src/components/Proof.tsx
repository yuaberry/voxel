import { MINE_RANK_COMMANDS, MINE_RANK_DATAPACK_FILE_COUNT, MINE_RANK_NS } from "../data";
import { CheckIcon, TerminalIcon } from "./Icons";

const CHECKS = [
  "Jar oficial do servidor vanilla 1.20.1, baixado do piston-meta da Mojang e conferido por SHA-1.",
  "Cliente real (protocolo de jogo) entra no servidor e digita os comandos no chat.",
  "Todos os objectives /trigger existem com o nome interno exato — provado pelo servidor.",
  "Cada comando dispara com o valor 1, 2 e 3: os menus e cada branch respondem.",
  "O jogador realmente minera: um bloco cavado paga level e coin de verdade.",
  "O log final do servidor não tem nenhum erro de comando.",
  "Nenhum tick travado: o mundo compacto segura a carga sem travar o servidor.",
];

export function Proof() {
  return (
    <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
      <div className="panel p-5 sm:p-6">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <CheckIcon className="h-4 w-4 text-emerald-400" /> O que o E2E prova
        </p>
        <ul className="mt-4 space-y-2.5">
          {CHECKS.map((check) => (
            <li key={check} className="flex gap-2.5 text-xs leading-relaxed text-muted-foreground">
              <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span>{check}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 rounded-lg border border-border/60 bg-background/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          rode no seu clone:
          <br />
          <span className="text-primary">VOXEL_E2E=1 pnpm vitest run</span>
          <br />
          <span className="text-primary">src/services/servers/mineRankServer.e2e.test.ts</span>
        </p>
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/60 bg-background/50 px-4 py-2.5">
          <TerminalIcon className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono text-[11px] text-muted-foreground">
            saída do teste real
          </span>
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
{`✓ src/services/servers/mineRankServer.e2e.test.ts (1 test) 56s
  ✓ Mine Rank — E2E real (vanilla 1.20.1 server)
    > plays the whole command surface with a real client
      and mines for real

  datapack      ${MINE_RANK_NS} (${MINE_RANK_DATAPACK_FILE_COUNT} arquivos) · pack format 15
  comandos      ${MINE_RANK_COMMANDS.length} × 3 valores = ${MINE_RANK_COMMANDS.length * 3} triggers
  erros         0
  stalls        0`}
        </pre>
        <div className="border-t border-border/60 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Como usar no seu servidor
          </p>
          <ol className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>1. No VOXEL: Servers → seu servidor → Console → aba <b>Mine Rank</b>.</li>
            <li>
              2. Clique em <b>Instalar</b> — o datapack{" "}
              <code className="font-mono">{MINE_RANK_NS}</code> é escrito no mundo.
            </li>
            <li>3. (Opcional) importe um mapa em ZIP preenchendo a atribuição e a licença.</li>
            <li>4. Reinicie (ou envie <code className="font-mono">reload</code>) e jogue.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
