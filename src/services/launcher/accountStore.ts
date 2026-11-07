import type { MinecraftAuthProvider } from "@/types";
import {
  secretsDelete,
  secretsGet,
  secretsSet,
} from "@/services/secrets/secretsService";
import { OAuthSessionCoordinator } from "@/services/launcher/oauthSessionCoordinator";

/**
 * The active provider is local account state, not a credential. It still
 * lives beside the tokens so switching providers never rewrites or destroys
 * the other provider's session.
 */
const ACTIVE_PROVIDER_KEY = "mc_active_provider";

/**
 * Provider selection is shared by Microsoft and Ely.by. Serializing every
 * active-provider mutation prevents concurrent provider sign-ins from
 * publishing an inconsistent active-account selection.
 */
export const accountStoreCoordinator = new OAuthSessionCoordinator();

export async function getActiveProvider(): Promise<MinecraftAuthProvider | null> {
  const value = await secretsGet(ACTIVE_PROVIDER_KEY);
  return value === "microsoft" || value === "elyby" ? value : null;
}

export async function setActiveProvider(provider: MinecraftAuthProvider): Promise<void> {
  await accountStoreCoordinator.mutate(async () => {
    await secretsSet(ACTIVE_PROVIDER_KEY, provider);
  });
}

export async function clearActiveProvider(): Promise<void> {
  await accountStoreCoordinator.mutate(async () => {
    await secretsDelete(ACTIVE_PROVIDER_KEY);
  });
}
