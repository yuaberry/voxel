/**
 * The user's OWN currency — the owner's real-economics ask:
 *  - design it (name, symbol, maximum supply, dilution policy, reference value)
 *  - circulating supply comes from the REAL ledger (mints minus burns)
 *  - value follows the dilution rule: the MORE tokens exist, the LESS each
 *    one is worth — reference / (1 + circulating / dilution)
 *  - quoted in USD and converted to BRL and EUR automatically with live
 *    European Central Bank rates (Rust fetches, caches 1h in the workspace)
 *
 * Compliance is honest and permanent: this is IN-GAME currency. It has no
 * monetary value, cannot be cashed out, and is not a cryptocurrency or a
 * financial product. The in-game economy indexes real FX rates — that is
 * the whole of the relationship with real money.
 */
import { invoke } from "@tauri-apps/api/core";
import { readProjectFile, writeProjectFile } from "@/services/projects/projectsService";
import { listLedger } from "./economyService";

export interface CurrencyConfig {
  name: string;
  symbol: string;
  maxSupply: number;
  /** higher = slower dilution (value falls later) */
  dilution: number;
  /** USD reference value per token at launch */
  referenceUsd: number;
}

export interface FxRates {
  usdBrl: number;
  usdEur: number;
  rateDate: string;
  fetchedAt: string;
}

export interface CurrencyValuation {
  config: CurrencyConfig;
  circulating: number;
  valueUsd: number;
  valueBrl: number;
  valueEur: number;
  fx: FxRates | null;
  /** honest note when FX is unavailable offline */
  fxNote: string | null;
}

const CURRENCY_PATH = (slug: string) => `servers/${slug}/.voxel/currency.json`;

export async function getCurrency(
  basePath: string,
  slug: string,
): Promise<CurrencyConfig | null> {
  try {
    const raw = await readProjectFile(basePath, CURRENCY_PATH(slug));
    return JSON.parse(raw) as CurrencyConfig;
  } catch {
    return null;
  }
}

export async function saveCurrency(
  basePath: string,
  slug: string,
  config: CurrencyConfig,
): Promise<void> {
  await writeProjectFile(
    basePath,
    CURRENCY_PATH(slug),
    JSON.stringify(config, null, 2),
  );
}

export async function getFxRates(basePath: string): Promise<FxRates | null> {
  try {
    return await invoke<FxRates>("fx_latest", { basePath });
  } catch {
    return null;
  }
}

/** The REAL dilution curve: more tokens, less value per token. */
export function tokenValueUsd(config: CurrencyConfig, circulating: number): number {
  if (config.dilution <= 0) return config.referenceUsd;
  return config.referenceUsd / (1 + Math.max(circulating, 0) / config.dilution);
}

/** Circulating supply is a FACT of the ledger: sum of mints minus burns. */
export async function circulatingSupply(basePath: string, slug: string): Promise<number> {
  try {
    const snapshot = await listLedger(basePath, slug);
    let total = 0;
    for (const block of snapshot.blocks) {
      if (block.tx === "mint" || block.tx === "genesis") total += block.amount;
      if (block.tx === "burn") total -= block.amount;
    }
    return total;
  } catch {
    return 0;
  }
}

export async function valueCurrency(
  basePath: string,
  slug: string,
  config: CurrencyConfig,
): Promise<CurrencyValuation> {
  const [circulating, fx] = await Promise.all([
    circulatingSupply(basePath, slug),
    getFxRates(basePath),
  ]);
  const valueUsd = tokenValueUsd(config, circulating);
  return {
    config,
    circulating,
    valueUsd,
    valueBrl: fx ? valueUsd * fx.usdBrl : 0,
    valueEur: fx ? valueUsd * fx.usdEur : 0,
    fx,
    fxNote: fx ? null : "FX offline — showing USD only (rates load when online)",
  };
}
