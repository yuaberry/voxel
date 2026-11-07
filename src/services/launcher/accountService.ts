import type { MinecraftAccount, MinecraftAuthProvider } from "@/types";
import {
  clearActiveProvider,
  getActiveProvider,
  setActiveProvider,
} from "@/services/launcher/accountStore";
import {
  getStoredMicrosoftAccount,
  signOutMicrosoft,
} from "@/services/launcher/authService";
import {
  ensureFreshElybyAccount,
  getStoredElybyAccount,
  signOutElyby,
} from "@/services/launcher/elyAuthService";

export interface StoredMinecraftAccounts {
  microsoft: MinecraftAccount | null;
  elyby: MinecraftAccount | null;
}

export interface StoredAccountState {
  accounts: StoredMinecraftAccounts;
  activeProvider: MinecraftAuthProvider | null;
}

export interface ProviderSignOutResult {
  warnings: string[];
}

export async function getStoredAccounts(): Promise<StoredMinecraftAccounts> {
  const [microsoft, elyby] = await Promise.all([
    getStoredMicrosoftAccount(),
    getStoredElybyAccount(),
  ]);
  return { microsoft, elyby };
}

/**
 * The effective provider is the single source of truth for both the UI and
 * launch. Only installations created before provider selection existed use
 * Microsoft as the compatibility fallback.
 */
export function selectEffectiveProvider(
  active: MinecraftAuthProvider | null,
  accounts: StoredMinecraftAccounts,
): MinecraftAuthProvider | null {
  if (active === "elyby") return accounts.elyby ? "elyby" : null;
  if (active === "microsoft") return accounts.microsoft ? "microsoft" : null;
  if (accounts.microsoft) return "microsoft";
  if (accounts.elyby) return "elyby";
  return null;
}

export async function getStoredAccountState(): Promise<StoredAccountState> {
  const [active, accounts] = await Promise.all([
    getActiveProvider(),
    getStoredAccounts(),
  ]);
  return {
    accounts,
    activeProvider: selectEffectiveProvider(active, accounts),
  };
}

export async function getEffectiveProvider(): Promise<MinecraftAuthProvider | null> {
  return (await getStoredAccountState()).activeProvider;
}

/** Returns the account selected for launching. */
export async function getStoredAccount(): Promise<MinecraftAccount | null> {
  const state = await getStoredAccountState();
  if (!state.activeProvider) return null;
  return state.accounts[state.activeProvider];
}

export async function activateProvider(
  provider: MinecraftAuthProvider,
): Promise<MinecraftAccount> {
  const accounts = await getStoredAccounts();
  const account = accounts[provider];
  if (!account) {
    throw new Error(`No ${provider} account is stored.`);
  }
  // Re-check presence immediately before publishing the selection. A sign-out
  // that won the race must not leave a dangling active provider behind.
  const latest = await getStoredAccounts();
  if (!latest[provider]) {
    throw new Error(`No ${provider} account is stored.`);
  }
  await setActiveProvider(provider);
  return latest[provider];
}

export async function signOutProvider(
  provider: MinecraftAuthProvider,
): Promise<ProviderSignOutResult> {
  const warnings: string[] = [];
  // The selection must be read before the sign-out: Ely.by's sign-out clears
  // the active provider itself, so reading it afterwards would look like
  // "this provider was never active" and skip the fallback to Microsoft.
  const activeBefore = await getActiveProvider();
  if (provider === "microsoft") {
    await signOutMicrosoft();
  } else {
    const result = await signOutElyby();
    warnings.push(...result.warnings);
  }

  if (activeBefore !== provider) return { warnings };

  // The other provider's session is untouched by the sign-out, so it can
  // take over the launch without the user signing in again.
  const accounts = await getStoredAccounts();
  const remaining = provider === "microsoft" ? accounts.elyby : accounts.microsoft;
  if (remaining) {
    await setActiveProvider(remaining.provider);
  } else {
    await clearActiveProvider();
  }
  return { warnings };
}

/**
 * Account used for an actual launch. Ely.by refresh tokens are used only
 * when the user explicitly starts the game and the access token is stale.
 */
export async function getLaunchAccount(): Promise<MinecraftAccount | null> {
  const account = await getStoredAccount();
  if (!account) return null;
  if (account.provider === "elyby") {
    return ensureFreshElybyAccount(account);
  }
  return account;
}
