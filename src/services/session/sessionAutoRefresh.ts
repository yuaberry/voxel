/**
 * Session Auto-Refresh (Super Prompt §9.10).
 *
 * Monitors the selected Minecraft session (Microsoft or Ely.by) and other
 * auth sessions, alerting the owner when a session is about to expire or has
 * expired.
 * Does NOT auto-reauthenticate (that would require user interaction),
 * but keeps the owner informed so they can re-authenticate before
 * losing access.
 *
 * Honest rules:
 * - Never stores or transmits credentials
 * - Only reads expiry timestamps already stored locally
 * - Never auto-logins; always requires owner action
 * - Alerts are honest: "session expires in X minutes" or "session expired"
 */

import { invoke } from "@tauri-apps/api/core";
import { getStoredAccount } from "@/services/launcher/accountService";

export interface SessionStatus {
  provider: "microsoft" | "elyby" | "github";
  authenticated: boolean;
  expiresAt: number | null;
  minutesRemaining: number | null;
  isExpiring: boolean; // less than 10 minutes remaining
  isExpired: boolean;
}

/**
 * Checks the selected Minecraft account session (Microsoft or Ely.by).
 * Returns null if no session exists, otherwise returns status.
 */
export async function checkMinecraftSession(): Promise<SessionStatus | null> {
  const account = await getStoredAccount();
  if (!account) return null;

  const expiry = account.expiresAt;
  const now = Date.now();
  const minutesRemaining = Math.max(0, Math.floor((expiry - now) / 60000));

  return {
    provider: account.provider,
    authenticated: expiry > now,
    expiresAt: expiry,
    minutesRemaining,
    isExpiring: minutesRemaining > 0 && minutesRemaining <= 10,
    isExpired: expiry <= now,
  };
}

/** Backwards-compatible alias for the original MSA-only monitor. */
export const checkMsnaSession = checkMinecraftSession;

/**
 * Auto-refresh loop: checks the MSA session every 5 minutes.
 * If a session is about to expire (≤10 min) or has expired,
 * notifies the owner via the app's notification system.
 *
 * Returns a stop function.
 */
export let autoRefreshInterval: ReturnType<typeof setInterval> | null = null;

export function startSessionAutoRefresh(
  onSessionExpiring?: (status: SessionStatus) => void,
  onSessionExpired?: (status: SessionStatus) => void,
): () => void {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }

  // Check immediately
  void checkAndNotify(onSessionExpiring, onSessionExpired);

  // Then every 5 minutes
  autoRefreshInterval = setInterval(() => {
    void checkAndNotify(onSessionExpiring, onSessionExpired);
  }, 5 * 60 * 1000);

  return () => {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  };
}

async function checkAndNotify(
  onSessionExpiring?: (status: SessionStatus) => void,
  onSessionExpired?: (status: SessionStatus) => void,
): Promise<void> {
  const status = await checkMinecraftSession();
  if (!status) return;

  const providerName = status.provider === "elyby" ? "Ely.by" : "Microsoft";
  if (status.isExpired) {
    onSessionExpired?.(status);
    // Notify via system notification
    try {
      await invoke("notify_desktop", {
        title: "VOXEL — Session Expired",
        body: `Your ${providerName} account session has expired. Sign in again in Settings → Launcher.`,
      }).catch(() => {});
    } catch {
      // Notify may not be available in all environments
    }
  } else if (status.isExpiring) {
    onSessionExpiring?.(status);
    try {
      await invoke("notify_desktop", {
        title: "VOXEL — Session Expiring Soon",
        body: `Your ${providerName} account session expires in ${status.minutesRemaining} minutes. Sign in again soon.`,
      }).catch(() => {});
    } catch {
      // Notify may not be available in all environments
    }
  }
}
