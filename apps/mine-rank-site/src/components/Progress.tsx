import {
  MINE_RANK_CLAN_SLOTS,
  MINE_RANK_CURRENCIES,
  MINE_RANK_MINE_RESET_BLOCKS,
  MINE_RANK_MINE_RESET_COST,
  MINE_RANK_ORE_LAYERS,
  MINE_RANK_PLOTS,
  MINE_RANK_PRESTIGE_LEVEL,
  MINE_RANK_RAID_MOBS,
  MINE_RANK_TIERS,
} from "../data";
import { CoinsIcon, PickaxeIcon, SparkIcon } from "./Icons";

export function Progress() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1.35fr_0.65fr]">
      <div>
        <div className="panel p-5 sm:p-6">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <SparkIcon className="h-4 w-4 text-primary" /> A escada de tiers
          </p>
          <ol className="mt-5 space-y-2">
            {MINE_RANK_TIERS.map((tier, index) => (
              <li
                key={tier.index}
                className="group flex items-center gap-4 rounded-xl border border-border/50 bg-background/40 p-3 transition-colors hover:border-primary/40"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-bold"
                  style={{
                    backgroundColor: `${tier.color}1f`,
                    color: tier.color,
                    boxShadow: `inset 0 0 0 1px ${tier.color}40`,
                  }}
                >
                  {tier.index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{tier.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {tier.reward}
                  </span>
                </span>
                <span className="shrink-0 rounded-full border border-border/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                  level {tier.minLevel}
                </span>
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: tier.color }}
                  aria-hidden
                />
                <span className="sr-only">{index + 1}º tier</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-lg border border-primary/25 bg-primary/8 p-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Prestígio</span> no level{" "}
            {MINE_RANK_PRESTIGE_LEVEL}: o level volta a 0, o jogador ganha +5 rubies,
            +1 cash, +10 tokens e <span className="text-foreground">+1 coin por bloco
            para sempre</span>.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="panel p-5">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <CoinsIcon className="h-4 w-4 text-primary" /> As quatro moedas
          </p>
          <ul className="mt-4 space-y-3">
            {MINE_RANK_CURRENCIES.map((currency) => (
              <li key={currency.id} className="rounded-xl border border-border/50 bg-background/40 p-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-lg font-mono text-sm"
                    style={{ backgroundColor: `${currency.color}1f`, color: currency.color }}
                  >
                    {currency.symbol}
                  </span>
                  {currency.name}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {currency.earns}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel p-5">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <PickaxeIcon className="h-4 w-4 text-primary" /> A economia da mina
          </p>
          <ul className="mt-4 space-y-2 text-xs text-muted-foreground">
            <li className="flex justify-between gap-3 border-b border-border/40 pb-2">
              <span>Blocos por restauração</span>
              <span className="font-mono text-foreground">{MINE_RANK_MINE_RESET_BLOCKS}</span>
            </li>
            <li className="flex justify-between gap-3 border-b border-border/40 pb-2">
              <span>Restauração manual</span>
              <span className="font-mono text-foreground">{MINE_RANK_MINE_RESET_COST} coins</span>
            </li>
            <li className="flex justify-between gap-3 border-b border-border/40 pb-2">
              <span>Terrenos com mina privada</span>
              <span className="font-mono text-foreground">{MINE_RANK_PLOTS}</span>
            </li>
            <li className="flex justify-between gap-3 border-b border-border/40 pb-2">
              <span>Camadas de minério</span>
              <span className="font-mono text-foreground">{MINE_RANK_ORE_LAYERS.length}</span>
            </li>
            <li className="flex justify-between gap-3 border-b border-border/40 pb-2">
              <span>Slots de clan</span>
              <span className="font-mono text-foreground">{MINE_RANK_CLAN_SLOTS}</span>
            </li>
            <li className="flex justify-between gap-3">
              <span>Mobs por expedição</span>
              <span className="font-mono text-foreground">{MINE_RANK_RAID_MOBS}</span>
            </li>
          </ul>
          <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground/80">
            camadas: {MINE_RANK_ORE_LAYERS.map((ore) => ore.replace("_ore", "")).join(" → ")}
          </p>
        </div>
      </div>
    </div>
  );
}
