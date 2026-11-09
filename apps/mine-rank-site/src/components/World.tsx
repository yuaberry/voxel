import {
  MINE_RANK_ARENA,
  MINE_RANK_DECK_Y,
  MINE_RANK_HUB,
  MINE_RANK_PLOT_COLUMNS,
  MINE_RANK_PLOT_ORIGIN,
  MINE_RANK_PLOTS,
  MINE_RANK_PLOT_SPACING,
  MINE_RANK_POND,
  PLOT_COLORS,
  mineRankPlotCenter,
} from "../data";
import { MapIcon } from "./Icons";

/** 1 block = 1 SVG unit; the world is small on purpose. */
const OX = 90;
const OZ = 9;
const px = (x: number) => x + OX;
const pz = (z: number) => z + OZ;
/** Where the "pesca" caption sits, under the pond label. */
const POND_LABEL_Z = 86;

export function World() {
  const plots = Array.from({ length: MINE_RANK_PLOTS }, (_, index) =>
    mineRankPlotCenter(index + 1),
  );
  // the grid is as deep as it needs to be for the real number of plots
  const rows = Math.ceil(MINE_RANK_PLOTS / MINE_RANK_PLOT_COLUMNS);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
      <div className="panel overflow-hidden p-4 sm:p-6">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <MapIcon className="h-4 w-4 text-primary" /> O mundo (vista de cima, escala 1:1)
        </p>

        <svg
          viewBox="0 0 170 104"
          className="mt-4 w-full"
          role="img"
          aria-label="Mapa do mundo do Mine Rank: hub no centro, oito terrenos em grade 4 por 2, lago ao norte e arena a oeste"
        >
          <defs>
            <linearGradient id="hub" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#9155ff" />
              <stop offset="100%" stopColor="#17d9f0" />
            </linearGradient>
            <radialGradient id="pond" cx="0.5" cy="0.5" r="0.6">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.15" />
            </radialGradient>
            <pattern id="blocks" width="4" height="4" patternUnits="userSpaceOnUse">
              <path
                d="M4 0H0V4"
                fill="none"
                stroke="hsl(228 36% 60% / 0.16)"
                strokeWidth="0.4"
              />
            </pattern>
          </defs>

          <rect x="0" y="0" width="170" height="104" fill="url(#blocks)" rx="6" />

          {/* arena */}
          <rect
            x={px(MINE_RANK_ARENA.x - 8)}
            y={pz(MINE_RANK_ARENA.z - 8)}
            width="17"
            height="17"
            rx="1.5"
            fill="#fb71851f"
            stroke="#fb7185"
            strokeWidth="0.6"
            strokeDasharray="2 1.5"
          />
          <text
            x={px(MINE_RANK_ARENA.x)}
            y={pz(MINE_RANK_ARENA.z + 1)}
            textAnchor="middle"
            className="fill-rose-300"
            style={{ fontSize: "4.5px", fontFamily: "JetBrains Mono, monospace" }}
          >
            ARENA
          </text>
          <text
            x={px(MINE_RANK_ARENA.x)}
            y={pz(MINE_RANK_ARENA.z + 6)}
            textAnchor="middle"
            className="fill-rose-200/70"
            style={{ fontSize: "3.2px", fontFamily: "JetBrains Mono, monospace" }}
          >
            expedição
          </text>

          {/* pond */}
          <rect
            x={px(MINE_RANK_POND.x - 6)}
            y={pz(MINE_RANK_POND.z - 6)}
            width="13"
            height="13"
            rx="2"
            fill="url(#pond)"
            stroke="#38bdf8"
            strokeWidth="0.5"
          />
          <text
            x={px(MINE_RANK_POND.x)}
            y={pz(MINE_RANK_POND.z + 1)}
            textAnchor="middle"
            className="fill-sky-200"
            style={{ fontSize: "4.5px", fontFamily: "JetBrains Mono, monospace" }}
          >
            LAGO
          </text>
          <text
            x={px(MINE_RANK_POND.x)}
            y={pz(POND_LABEL_Z)}
            textAnchor="middle"
            className="fill-sky-200/70"
            style={{ fontSize: "3.2px", fontFamily: "JetBrains Mono, monospace" }}
          >
            pesca
          </text>

          {/* plots */}
          {plots.map((plot, index) => (
            <g key={index}>
              <rect
                x={px(plot.x - 5)}
                y={pz(plot.z - 5)}
                width="11"
                height="11"
                rx="1.5"
                fill={`${PLOT_COLORS[index]}1c`}
                stroke={PLOT_COLORS[index]}
                strokeWidth="0.5"
                strokeOpacity="0.8"
              />
              {/* the 3x3 hole of the private shaft */}
              <rect
                x={px(plot.x - 1)}
                y={pz(plot.z - 1)}
                width="3"
                height="3"
                fill="#05070c"
                stroke={PLOT_COLORS[index]}
                strokeWidth="0.3"
                strokeOpacity="0.5"
              />
              <text
                x={px(plot.x)}
                y={pz(plot.z + 1)}
                textAnchor="middle"
                fill={PLOT_COLORS[index]}
                style={{ fontSize: "4px", fontFamily: "JetBrains Mono, monospace" }}
              >
                {index + 1}
              </text>
            </g>
          ))}

          {/* hub */}
          <rect
            x={px(MINE_RANK_HUB.x - 6)}
            y={pz(MINE_RANK_HUB.z - 6)}
            width="13"
            height="13"
            rx="2"
            fill="url(#hub)"
            fillOpacity="0.22"
            stroke="url(#hub)"
            strokeWidth="0.7"
          />
          <circle
            cx={px(MINE_RANK_HUB.x)}
            cy={pz(MINE_RANK_HUB.z)}
            r="1.6"
            fill="url(#hub)"
          />
          <text
            x={px(MINE_RANK_HUB.x)}
            y={pz(MINE_RANK_HUB.z + 5)}
            textAnchor="middle"
            className="fill-violet-200"
            style={{ fontSize: "4.5px", fontFamily: "JetBrains Mono, monospace" }}
          >
            HUB
          </text>
          <text
            x={px(MINE_RANK_HUB.x)}
            y={pz(MINE_RANK_HUB.z + 9)}
            textAnchor="middle"
            className="fill-violet-200/70"
            style={{ fontSize: "3.2px", fontFamily: "JetBrains Mono, monospace" }}
          >
            spawn
          </text>

          {/* the compact corridor */}
          <path
            d={`M ${px(MINE_RANK_ARENA.x)} ${pz(MINE_RANK_ARENA.z)} L ${px(MINE_RANK_HUB.x)} ${pz(MINE_RANK_HUB.z)} L ${px(MINE_RANK_POND.x)} ${pz(MINE_RANK_POND.z)}`}
            fill="none"
            stroke="hsl(258 96% 70% / 0.45)"
            strokeWidth="0.6"
            strokeDasharray="3 2"
          />
        </svg>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-primary/60" /> hub (spawn)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-primary/50" /> terreno com mina
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-sky-400/40" /> lago
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-rose-400/70" /> arena
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Coordenadas reais
          </p>
          <ul className="mt-4 space-y-2 font-mono text-[11px] text-muted-foreground">
            <li className="flex justify-between gap-3 border-b border-border/40 pb-2">
              <span>hub (spawn)</span>
              <span className="text-foreground">
                {MINE_RANK_HUB.x} {MINE_RANK_HUB.y} {MINE_RANK_HUB.z}
              </span>
            </li>
            <li className="flex justify-between gap-3 border-b border-border/40 pb-2">
              <span>terreno 1</span>
              <span className="text-foreground">
                {mineRankPlotCenter(1).x} {MINE_RANK_DECK_Y} {mineRankPlotCenter(1).z}
              </span>
            </li>
            <li className="flex justify-between gap-3 border-b border-border/40 pb-2">
              <span>terreno 8</span>
              <span className="text-foreground">
                {mineRankPlotCenter(8).x} {MINE_RANK_DECK_Y} {mineRankPlotCenter(8).z}
              </span>
            </li>
            <li className="flex justify-between gap-3 border-b border-border/40 pb-2">
              <span>lago</span>
              <span className="text-foreground">
                {MINE_RANK_POND.x} {MINE_RANK_POND.y} {MINE_RANK_POND.z}
              </span>
            </li>
            <li className="flex justify-between gap-3">
              <span>arena</span>
              <span className="text-foreground">
                {MINE_RANK_ARENA.x} {MINE_RANK_ARENA.y} {MINE_RANK_ARENA.z}
              </span>
            </li>
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            A grade é de {MINE_RANK_PLOT_COLUMNS} colunas × {rows} linhas, começando em{" "}
            {MINE_RANK_PLOT_ORIGIN} com {MINE_RANK_PLOT_SPACING} blocos de distância.
          </p>
        </div>

        <div className="panel border-warning/30 bg-warning/5 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warning">
            Por que o mundo é pequeno
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            No E2E real, um teleporte de <span className="text-foreground">48 chunks</span>{" "}
            fez o vanilla carregar o corredor inteiro: ~45 segundos de tick travado e o
            watchdog matando o servidor. Aqui tudo fica a{" "}
            <span className="text-foreground">no máximo 5 chunks do hub</span> — o mundo
            nasce e responde instantaneamente, em qualquer bioma.
          </p>
        </div>

        <div className="panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            O que existe em cada terreno
          </p>
          <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>· deck próprio em y=100 (uma plataforma, acima de qualquer terreno)</li>
            <li>· um furo 3×3 no centro e uma mina de 8 camadas de minério</li>
            <li>· anel colorido — cada terreno tem a sua cor</li>
            <li>· restauração automática a cada 100 blocos (ou por 25 coins)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
