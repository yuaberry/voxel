/**
 * Microsoft account authentication (device flow) — the legitimate flow used
 * by open-source launchers. Requires an MSA client_id (Azure app
 * registration) configured in Settings → Launcher; nothing is bypassed.
 *
 * Flow: device code -> MSA token -> Xbox Live -> XSTS -> Minecraft services
 * token -> profile. Secrets go to the OS keyring.
 */

import { toast } from "sonner";
import type { MinecraftAccount } from "@/types";
import {
  secretsDelete,
  secretsGet,
  secretsHas,
  secretsSet,
} from "@/services/secrets/secretsService";
import { setActiveProvider } from "@/services/launcher/accountStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  fetchTextWithTimeout,
  throwIfAborted,
  waitWithAbort,
} from "@/services/launcher/oauthHttp";
import { OAuthSessionCoordinator } from "@/services/launcher/oauthSessionCoordinator";

const DEVICE_CODE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_AUTH_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

const KEY_USERNAME = "mc_username";
const KEY_UUID = "mc_uuid";
const KEY_TOKEN = "mc_access_token";
const KEY_EXPIRY = "mc_token_expiry";

const sessionCoordinator = new OAuthSessionCoordinator();

export interface MicrosoftSignInOptions {
  /** Draft value from Settings, used before the persisted save completes. */
  clientId?: string;
  signal?: AbortSignal;
}

async function postForm<T>(
  url: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const { response, text } = await fetchTextWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    },
    signal,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 250)}`);
  }
  return JSON.parse(text) as T;
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const { response, text } = await fetchTextWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    signal,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}

function microsoftClientId(override?: string): string {
  return (
    override?.trim() ||
    useSettingsStore.getState().settings.launcher.clientId.trim()
  );
}

export function isMicrosoftAuthConfigured(): boolean {
  return microsoftClientId().length > 10;
}

export async function getStoredMicrosoftAccount(): Promise<MinecraftAccount | null> {
  const [username, uuid, token, expiry] = await Promise.all([
    secretsGet(KEY_USERNAME),
    secretsGet(KEY_UUID),
    secretsGet(KEY_TOKEN),
    secretsGet(KEY_EXPIRY),
  ]);
  if (!username || !uuid || !token) return null;
  const expiresAt = Number(expiry ?? 0);
  return {
    provider: "microsoft",
    username,
    uuid,
    accessToken: token,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
  };
}

export async function hasStoredMicrosoftAccount(): Promise<boolean> {
  return secretsHas(KEY_TOKEN);
}

async function storeMicrosoftAccount(account: MinecraftAccount): Promise<void> {
  try {
    await secretsSet(KEY_USERNAME, account.username);
    await secretsSet(KEY_UUID, account.uuid);
    await secretsSet(KEY_EXPIRY, String(account.expiresAt));
    // Write the access token last: its presence means the session is complete.
    await secretsSet(KEY_TOKEN, account.accessToken);
  } catch (error) {
    for (const key of [KEY_USERNAME, KEY_UUID, KEY_TOKEN, KEY_EXPIRY]) {
      await secretsDelete(key).catch(() => {});
    }
    throw error;
  }
}

export async function signOutMicrosoft(): Promise<void> {
  await sessionCoordinator.mutate(async () => {
    sessionCoordinator.invalidate();
    for (const key of [KEY_USERNAME, KEY_UUID, KEY_TOKEN, KEY_EXPIRY]) {
      await secretsDelete(key);
    }
  });
}

/**
 * Runs the full device-flow sign-in. `onUserCode` receives the code + URL
 * the user must open in a browser.
 */
export async function signInWithMicrosoft(
  onUserCode: (info: { userCode: string; verificationUrl: string }) => void,
  options: MicrosoftSignInOptions = {},
): Promise<MinecraftAccount> {
  const id = microsoftClientId(options.clientId);
  if (!id) {
    throw new Error("MSA client_id not configured — Settings → Launcher.");
  }

  const operation = sessionCoordinator.startOperation();

  // 1. Device code
  const device = await postForm<{
    user_code: string;
    verification_uri: string;
    device_code: string;
    interval?: number;
    expires_in: number;
  }>(
    DEVICE_CODE_URL,
    { client_id: id, scope: "XboxLive.signin offline_access" },
    options.signal,
  );
  if (
    !device.device_code ||
    !device.user_code ||
    !device.verification_uri ||
    !Number.isFinite(device.expires_in) ||
    device.expires_in <= 0
  ) {
    throw new Error("Microsoft device authorization returned an invalid response.");
  }
  throwIfAborted(options.signal, "Microsoft sign-in cancelled");
  sessionCoordinator.assertCurrent(operation, "Microsoft sign-in superseded");
  onUserCode({
    userCode: device.user_code,
    verificationUrl: device.verification_uri,
  });

  // 2. Poll for the MSA token
  let pollSeconds = Math.max(1, device.interval ?? 5);
  const deadline = Date.now() + device.expires_in * 1000;
  let msaToken = "";
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await waitWithAbort(
      Math.min(pollSeconds * 1000, remaining),
      options.signal,
      "Microsoft sign-in cancelled",
    );
    sessionCoordinator.assertCurrent(operation, "Microsoft sign-in superseded");
    throwIfAborted(options.signal, "Microsoft sign-in cancelled");
    if (Date.now() >= deadline) break;
    try {
      const tokenResponse = await postForm<{ access_token?: string }>(
        TOKEN_URL,
        {
          client_id: id,
          device_code: device.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        },
        options.signal,
      );
      if (tokenResponse.access_token) {
        msaToken = tokenResponse.access_token;
        break;
      }
    } catch (error) {
      const message = String(error);
      if (message.includes("authorization_pending")) {
        continue; // keep polling
      }
      if (message.includes("slow_down")) {
        pollSeconds += 5;
        continue;
      }
      throw error; // declined / expired / network
    }
  }
  if (!msaToken) {
    throw new Error("Sign-in timed out — try again.");
  }

  // 3. Xbox Live user token
  const xbl = await postJson<{
    Token: string;
    DisplayClaims: { xui: Array<{ uhs: string }> };
  }>(
    XBL_URL,
    {
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msaToken}`,
      },
    },
    options.signal,
  );
  if (!xbl.Token) throw new Error("Xbox Live did not return a token.");

  // 4. XSTS token
  const xsts = await postJson<{
    Token: string;
    DisplayClaims: { xui: Array<{ uhs: string }> };
  }>(
    XSTS_URL,
    { Properties: { SandboxId: "XTST", UserTokens: [xbl.Token] } },
    options.signal,
  );
  const uhs = xsts.DisplayClaims?.xui?.[0]?.uhs;
  if (!uhs || !xsts.Token) {
    throw new Error("XSTS did not return a user hash.");
  }

  // 5. Minecraft services token
  const mc = await postJson<{ access_token: string; expires_in: number }>(
    MC_AUTH_URL,
    { identityToken: `XBL3.0 x=${xsts.Token};${uhs}` },
    options.signal,
  );
  if (!mc.access_token || !Number.isFinite(mc.expires_in) || mc.expires_in <= 0) {
    throw new Error("Minecraft services returned an invalid session.");
  }

  // 6. Profile (name + uuid)
  const { response: profileRes, text: profileText } = await fetchTextWithTimeout(
    MC_PROFILE_URL,
    { headers: { Authorization: `Bearer ${mc.access_token}` } },
    options.signal,
  );
  if (!profileRes.ok) {
    throw new Error(
      profileRes.status === 404
        ? "This Microsoft account has no Minecraft profile (game ownership required)."
        : `Profile lookup failed: HTTP ${profileRes.status}`,
    );
  }
  const profile = JSON.parse(profileText) as { name: string; id: string };
  if (!profile.name || !profile.id || !/^[A-Za-z0-9_]{3,16}$/.test(profile.name)) {
    throw new Error("Minecraft services returned an invalid profile.");
  }
  const uuid = profile.id.replace(
    /(.{8})(.{4})(.{4})(.{4})(.{12})/,
    "$1-$2-$3-$4-$5",
  );
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      uuid,
    )
  ) {
    throw new Error("Minecraft services returned an invalid profile UUID.");
  }

  const account: MinecraftAccount = {
    provider: "microsoft",
    username: profile.name,
    uuid,
    accessToken: mc.access_token,
    expiresAt: Date.now() + Math.max(0, mc.expires_in - 60) * 1000,
  };
  await sessionCoordinator.mutate(async () => {
    sessionCoordinator.assertCurrent(operation, "Microsoft sign-in superseded");
    throwIfAborted(options.signal, "Microsoft sign-in cancelled");
    await storeMicrosoftAccount(account);
    await setActiveProvider("microsoft");
  });
  toast.success(`Signed in as ${profile.name}`);
  return account;
}
