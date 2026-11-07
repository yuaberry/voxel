/**
 * Ely.by authentication — official OAuth 2.0 device flow.
 *
 * VOXEL never asks for the player's password. The account owner approves a
 * short-lived user code on Ely.by, and the resulting OAuth tokens stay in
 * the OS keyring. The `minecraft_server_session` scope lets the official
 * authlib-injector route Minecraft sessions through Ely.by.
 */

import { toast } from "sonner";
import type { MinecraftAccount } from "@/types";
import {
  secretsDelete,
  secretsGet,
  secretsSet,
} from "@/services/secrets/secretsService";
import {
  clearActiveProvider,
  getActiveProvider,
  setActiveProvider,
} from "@/services/launcher/accountStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  fetchTextWithTimeout,
  OAUTH_REQUEST_TIMEOUT_MS,
  throwIfAborted,
  waitWithAbort,
} from "@/services/launcher/oauthHttp";
import { OAuthSessionCoordinator } from "@/services/launcher/oauthSessionCoordinator";

const DEVICE_CODE_URL = "https://account.ely.by/api/oauth2/v1/devicecode";
const TOKEN_URL = "https://account.ely.by/api/oauth2/v1/token";
const REVOKE_URL = "https://account.ely.by/api/oauth2/v1/revoke";
const PROFILE_URL = "https://account.ely.by/api/mojang/services/minecraft/profile";

export const ELYBY_SCOPES = "account_info offline_access minecraft_server_session";

const KEY_USERNAME = "ely_username";
const KEY_UUID = "ely_uuid";
const KEY_TOKEN = "ely_access_token";
const KEY_EXPIRY = "ely_token_expiry";
const KEY_REFRESH_TOKEN = "ely_refresh_token";
const KEY_CLIENT_ID = "ely_client_id";

const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const sessionCoordinator = new OAuthSessionCoordinator();
let refreshInFlight: Promise<MinecraftAccount> | null = null;

export interface ElybySignInOptions {
  /** Draft value from Settings, used before the persisted save completes. */
  clientId?: string;
  signal?: AbortSignal;
}

export interface ElybyDeviceCodeInfo {
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete?: string;
}

export interface ElybySignOutResult {
  remoteRevoked: boolean;
  warnings: string[];
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval?: number;
  expires_in: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface ElybyProfile {
  id: string;
  name: string;
}

export class ElybyOAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, description: string) {
    super(description || code || `HTTP ${status}`);
    this.name = "ElybyOAuthError";
    this.status = status;
    this.code = code;
  }
}

function parseOAuthError(status: number, text: string): ElybyOAuthError {
  let code = `http_${status}`;
  let description = text.slice(0, 250);
  try {
    const payload = JSON.parse(text) as {
      error?: string;
      error_description?: string;
      message?: string;
    };
    if (payload.error) code = payload.error;
    description = payload.error_description || payload.message || description;
  } catch {
    // Keep the bounded server response for non-JSON failures.
  }
  return new ElybyOAuthError(status, code, description);
}

function parseJsonObject(text: string, context: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${context} returned invalid JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} returned an invalid response.`);
  }
  return value as Record<string, unknown>;
}

async function postForm(
  url: string,
  params: Record<string, string>,
  signal?: AbortSignal,
  timeoutMs = OAUTH_REQUEST_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const { response, text } = await fetchTextWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    },
    signal,
    timeoutMs,
  );
  if (!response.ok) throw parseOAuthError(response.status, text);
  return parseJsonObject(text, "Ely.by");
}

async function postFormAllowEmpty(
  url: string,
  params: Record<string, string>,
): Promise<void> {
  const { response, text } = await fetchTextWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!response.ok) throw parseOAuthError(response.status, text);
}

function requiredString(
  payload: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} did not return ${key}.`);
  }
  return value.trim();
}

function optionalString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function positiveNumber(
  payload: Record<string, unknown>,
  key: string,
  context: string,
  required = false,
): number | undefined {
  const value = payload[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${context} returned an invalid ${key}.`);
  }
  return value;
}

function validateElybyUrl(raw: string, context: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${context} returned an invalid URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "account.ely.by" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !["/code", "/dev/applications/new"].includes(url.pathname)
  ) {
    throw new Error(`${context} returned an untrusted URL.`);
  }
  return raw;
}

function parseDeviceResponse(
  payload: Record<string, unknown>,
): DeviceCodeResponse {
  const context = "Ely.by device authorization";
  const verificationUri = validateElybyUrl(
    requiredString(payload, "verification_uri", context),
    context,
  );
  const completeUri = optionalString(payload, "verification_uri_complete");
  return {
    device_code: requiredString(payload, "device_code", context),
    user_code: requiredString(payload, "user_code", context),
    verification_uri: verificationUri,
    verification_uri_complete: completeUri
      ? validateElybyUrl(completeUri, context)
      : undefined,
    interval: positiveNumber(payload, "interval", context),
    expires_in: positiveNumber(payload, "expires_in", context, true) as number,
  };
}

function parseTokenResponse(payload: Record<string, unknown>): TokenResponse {
  const context = "Ely.by token endpoint";
  return {
    access_token: optionalString(payload, "access_token"),
    refresh_token: optionalString(payload, "refresh_token"),
    expires_in: positiveNumber(payload, "expires_in", context),
    token_type: optionalString(payload, "token_type"),
  };
}

function parseProfileResponse(payload: Record<string, unknown>): ElybyProfile {
  const context = "Ely.by profile endpoint";
  const id = requiredString(payload, "id", context);
  const name = requiredString(payload, "name", context);
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error(`${context} returned an invalid Minecraft username.`);
  }
  return { id, name };
}

function configuredClientId(override?: string): string {
  return (
    override?.trim() ||
    useSettingsStore.getState().settings.launcher.elyClientId.trim()
  );
}

export function isElybyAuthConfigured(): boolean {
  return configuredClientId().length > 0;
}

/** Converts Ely.by's 32-character UUID into Minecraft's canonical form. */
export function normalizeMinecraftUuid(raw: string): string {
  const compact = raw.trim().replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new Error("Ely.by returned an invalid Minecraft UUID.");
  }
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function tokenExpiry(expiresIn: number | undefined): number {
  if (!expiresIn || expiresIn <= 0) return 0;
  return Date.now() + Math.max(0, expiresIn - 60) * 1000;
}

export async function getStoredElybyAccount(): Promise<MinecraftAccount | null> {
  const [username, uuid, token, expiry] = await Promise.all([
    secretsGet(KEY_USERNAME),
    secretsGet(KEY_UUID),
    secretsGet(KEY_TOKEN),
    secretsGet(KEY_EXPIRY),
  ]);
  if (!username || !uuid || !token) return null;
  const expiresAt = Number(expiry ?? 0);
  return {
    provider: "elyby",
    username,
    uuid,
    accessToken: token,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
  };
}

/**
 * A stored Ely.by session is only usable when the whole credential set is
 * present: an access token alone cannot be refreshed, and the client id must
 * be known to own the refresh grant.
 */
export async function hasStoredElybyAccount(): Promise<boolean> {
  const [username, uuid, token, refreshToken, clientId] = await Promise.all([
    secretsGet(KEY_USERNAME),
    secretsGet(KEY_UUID),
    secretsGet(KEY_TOKEN),
    secretsGet(KEY_REFRESH_TOKEN),
    secretsGet(KEY_CLIENT_ID),
  ]);
  return Boolean(username && uuid && token && refreshToken && clientId);
}

async function storeElybySession(
  account: MinecraftAccount,
  refreshToken: string,
  clientId: string,
): Promise<void> {
  try {
    await secretsSet(KEY_USERNAME, account.username);
    await secretsSet(KEY_UUID, account.uuid);
    await secretsSet(KEY_EXPIRY, String(account.expiresAt));
    await secretsSet(KEY_REFRESH_TOKEN, refreshToken);
    await secretsSet(KEY_CLIENT_ID, clientId);
    // Write the access token last: its presence means the session is complete.
    await secretsSet(KEY_TOKEN, account.accessToken);
  } catch (error) {
    await clearElybyCredentials();
    throw error;
  }
}

async function clearElybyCredentials(): Promise<void> {
  for (const key of [
    KEY_USERNAME,
    KEY_UUID,
    KEY_TOKEN,
    KEY_EXPIRY,
    KEY_REFRESH_TOKEN,
    KEY_CLIENT_ID,
  ]) {
    await secretsDelete(key).catch(() => {});
  }
}

export async function signOutElyby(): Promise<ElybySignOutResult> {
  const warnings: string[] = [];
  const [refreshToken, clientId] = await Promise.all([
    secretsGet(KEY_REFRESH_TOKEN),
    secretsGet(KEY_CLIENT_ID),
  ]);

  // Local cleanup is unconditional, even when remote revocation fails.
  // Serializing it with OAuth mutations prevents a late refresh from
  // recreating credentials after sign-out.
  await sessionCoordinator.mutate(async () => {
    sessionCoordinator.invalidate();
    for (const key of [
      KEY_USERNAME,
      KEY_UUID,
      KEY_TOKEN,
      KEY_EXPIRY,
      KEY_REFRESH_TOKEN,
      KEY_CLIENT_ID,
    ]) {
      try {
        await secretsDelete(key);
      } catch (error) {
        warnings.push(
          `Could not remove ${key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const active = await getActiveProvider();
    if (active === "elyby") await clearActiveProvider();
  });

  let remoteRevoked = false;
  if (refreshToken && clientId) {
    try {
      await postFormAllowEmpty(REVOKE_URL, {
        token: refreshToken,
        token_type_hint: "refresh_token",
        client_id: clientId,
      });
      remoteRevoked = true;
    } catch (error) {
      warnings.push(
        `Ely.by could not revoke the remote grant: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { remoteRevoked, warnings };
}

/**
 * Runs Ely.by's RFC 8628 device flow. Desktop applications are public OAuth
 * clients, so no client secret is required or stored.
 */
export async function signInWithElyby(
  onUserCode: (info: ElybyDeviceCodeInfo) => void,
  options: ElybySignInOptions = {},
): Promise<MinecraftAccount> {
  const clientId = configuredClientId(options.clientId);
  if (!clientId) {
    throw new Error("Ely.by client id not configured — Settings → Launcher.");
  }

  const operation = sessionCoordinator.startOperation();
  const devicePayload = await postForm(
    DEVICE_CODE_URL,
    {
      client_id: clientId,
      scope: ELYBY_SCOPES,
    },
    options.signal,
    OAUTH_REQUEST_TIMEOUT_MS,
  );
  const device = parseDeviceResponse(devicePayload);
  throwIfAborted(options.signal, "Ely.by sign-in cancelled");
  sessionCoordinator.assertCurrent(operation, "Ely.by sign-in superseded");
  onUserCode({
    userCode: device.user_code,
    verificationUrl: device.verification_uri,
    verificationUrlComplete: device.verification_uri_complete,
  });

  let pollSeconds = Math.max(1, device.interval ?? 5);
  const deadline = Date.now() + device.expires_in * 1000;
  let token: TokenResponse | null = null;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await waitWithAbort(
      Math.min(pollSeconds * 1000, remaining),
      options.signal,
      "Ely.by sign-in cancelled",
    );
    sessionCoordinator.assertCurrent(operation, "Ely.by sign-in superseded");
    throwIfAborted(options.signal, "Ely.by sign-in cancelled");
    if (Date.now() >= deadline) break;

    try {
      const payload = await postForm(
        TOKEN_URL,
        {
          client_id: clientId,
          device_code: device.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        },
        options.signal,
        Math.min(OAUTH_REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now())),
      );
      token = parseTokenResponse(payload);
      break;
    } catch (error) {
      if (error instanceof ElybyOAuthError && error.code === "authorization_pending") {
        continue;
      }
      if (error instanceof ElybyOAuthError && error.code === "slow_down") {
        pollSeconds += 5;
        continue;
      }
      throw error;
    }
  }

  if (!token?.access_token) {
    throw new Error("Ely.by sign-in timed out — try again.");
  }
  if (!token.refresh_token) {
    throw new Error("Ely.by did not issue a refresh token. Check the requested scopes.");
  }

  const { response: profileRes, text: profileText } = await fetchTextWithTimeout(
    PROFILE_URL,
    { headers: { Authorization: `Bearer ${token.access_token}` } },
    options.signal,
  );
  if (!profileRes.ok) {
    throw parseOAuthError(profileRes.status, profileText);
  }
  const profile = parseProfileResponse(parseJsonObject(profileText, "Ely.by"));

  const account: MinecraftAccount = {
    provider: "elyby",
    username: profile.name,
    uuid: normalizeMinecraftUuid(profile.id),
    accessToken: token.access_token,
    expiresAt: tokenExpiry(token.expires_in),
  };

  // The provider selection is read before the commit so a cancelled sign-in
  // can restore the previous selection instead of leaving a dangling one.
  const previousActive = await getActiveProvider();
  await sessionCoordinator.mutate(async () => {
    sessionCoordinator.assertCurrent(operation, "Ely.by sign-in superseded");
    throwIfAborted(options.signal, "Ely.by sign-in cancelled");
    try {
      await storeElybySession(account, token!.refresh_token!, clientId);
      await setActiveProvider("elyby");
      // A cancellation arriving during the final writes wins over the commit.
      throwIfAborted(options.signal, "Ely.by sign-in cancelled");
    } catch (error) {
      // Roll the whole commit back: a cancelled sign-in must never leave
      // credentials behind, nor an active provider pointing at them.
      await clearElybyCredentials();
      try {
        if (previousActive === "microsoft") {
          await setActiveProvider("microsoft");
        } else {
          await clearActiveProvider();
        }
      } catch {
        // Best-effort: the credentials are already gone, so the selection
        // cannot resolve to a usable account.
      }
      throw error;
    }
  });

  toast.success(`Signed in to Ely.by as ${profile.name}`);
  return account;
}

async function refreshElybyAccountImpl(
  account?: MinecraftAccount,
): Promise<MinecraftAccount> {
  const stored = account ?? (await getStoredElybyAccount());
  if (!stored || stored.provider !== "elyby") {
    throw new Error("No Ely.by account is stored.");
  }

  // Refreshes do not create a new generation. The generation captured here
  // must match after the network round-trip, and the stored account identity
  // is checked again before the write. Together these reject a refresh that
  // began before a newer sign-in committed.
  const operation = sessionCoordinator.version;
  const [refreshToken, storedClientId] = await Promise.all([
    secretsGet(KEY_REFRESH_TOKEN),
    secretsGet(KEY_CLIENT_ID),
  ]);
  if (!refreshToken) {
    throw new Error("The Ely.by session cannot be refreshed. Sign in again.");
  }
  const clientId = storedClientId?.trim() || configuredClientId();
  if (!clientId) {
    throw new Error("Ely.by client id not configured — Settings → Launcher.");
  }

  const payload = await postForm(TOKEN_URL, {
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: ELYBY_SCOPES,
  });
  const token = parseTokenResponse(payload);
  if (!token.access_token) {
    throw new Error("Ely.by did not return a refreshed access token.");
  }

  const refreshed: MinecraftAccount = {
    ...stored,
    accessToken: token.access_token,
    expiresAt: tokenExpiry(token.expires_in),
  };
  await sessionCoordinator.mutate(async () => {
    sessionCoordinator.assertCurrent(operation, "Ely.by session changed");

    // The account identity is part of the session. Refuse to write a token
    // from one account over another account's freshly committed session.
    const current = await getStoredElybyAccount();
    if (
      !current ||
      current.uuid !== stored.uuid ||
      current.username !== stored.username ||
      current.accessToken !== stored.accessToken
    ) {
      throw new DOMException("Ely.by session changed", "AbortError");
    }

    try {
      // Invalidate the old access token before changing metadata. If a write
      // fails, no stale token can be paired with a fresh expiry timestamp.
      await secretsDelete(KEY_TOKEN);
      await secretsSet(KEY_EXPIRY, String(refreshed.expiresAt));
      if (token.refresh_token) {
        await secretsSet(KEY_REFRESH_TOKEN, token.refresh_token);
      }
      await secretsSet(KEY_TOKEN, refreshed.accessToken);
    } catch (error) {
      await clearElybyCredentials();
      throw error;
    }
  });
  return refreshed;
}

/** Refreshes an existing Ely.by session without asking for the password. */
export function refreshElybyAccount(
  account?: MinecraftAccount,
): Promise<MinecraftAccount> {
  if (refreshInFlight) return refreshInFlight;
  const operation = refreshElybyAccountImpl(account);
  refreshInFlight = operation;
  const clear = () => {
    if (refreshInFlight === operation) refreshInFlight = null;
  };
  operation.then(clear, clear);
  return operation;
}

/** Refreshes only when the session is expired or close to expiry. */
export async function ensureFreshElybyAccount(
  account?: MinecraftAccount,
): Promise<MinecraftAccount | null> {
  const stored = account ?? (await getStoredElybyAccount());
  if (!stored) return null;
  if (stored.expiresAt > Date.now() + REFRESH_WINDOW_MS) return stored;
  return refreshElybyAccount(stored);
}
