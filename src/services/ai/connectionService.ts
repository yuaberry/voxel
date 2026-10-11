import { fetch } from "@tauri-apps/plugin-http";
import { getProviderMeta } from "@/services/ai/providers";
import type { AiConnectionTestResult, AiSettings } from "@/types";

const REQUEST_TIMEOUT_MS = 15000;

function resolveBaseUrl(settings: AiSettings): string {
  const meta = getProviderMeta(settings.provider);
  return settings.baseUrl?.trim() ? settings.baseUrl.trim() : meta.defaultBaseUrl;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error("Request timed out after 15 seconds")),
        REQUEST_TIMEOUT_MS,
      ),
    ),
  ]);
}

function httpError(status: number, body: string): Error {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    detail = parsed.error?.message ?? "";
  } catch {
    detail = body.slice(0, 200);
  }
  return new Error(
    `HTTP ${status}${detail ? `: ${detail}` : " — check your key, model and network"}`,
  );
}

/**
 * Validates credentials/connectivity against the configured provider.
 * Uses the Tauri HTTP plugin (Rust-side fetch), so browser CORS does not apply.
 */
export async function testAiConnection(
  settings: AiSettings,
  apiKey: string | null,
): Promise<AiConnectionTestResult> {
  const meta = getProviderMeta(settings.provider);
  const started = performance.now();

  try {
    if (meta.requiresKey && !apiKey) {
      return {
        ok: false,
        message: "No API key stored for this provider.",
        latencyMs: 0,
      };
    }

    let ok = false;
    const details: Record<string, string> = {};

    switch (settings.provider) {
      case "openrouter": {
        const res = await withTimeout(
          fetch("https://openrouter.ai/api/v1/auth/key", {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
          }),
        );
        if (!res.ok) throw httpError(res.status, await res.text());
        const body = (await res.json()) as {
          data?: { label?: string | null; is_free_tier?: boolean | null; limit?: number | null };
        };
        ok = true;
        if (body.data) {
          details.account = body.data.label ?? "(unlabeled key)";
          if (typeof body.data.is_free_tier === "boolean") {
            details.tier = body.data.is_free_tier ? "free tier" : "paid";
          }
        }
        break;
      }

      case "openai": {
        const res = await withTimeout(
          fetch(`${resolveBaseUrl(settings)}/models`, {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
          }),
        );
        if (!res.ok) throw httpError(res.status, await res.text());
        const body = (await res.json()) as { data?: Array<{ id: string }> };
        ok = true;
        details.modelsAvailable = String(body.data?.length ?? 0);
        break;
      }

      case "anthropic": {
        const res = await withTimeout(
          fetch(`${resolveBaseUrl(settings)}/v1/models`, {
            method: "GET",
            headers: {
              "x-api-key": apiKey ?? "",
              "anthropic-version": "2023-06-01",
            },
          }),
        );
        if (!res.ok) throw httpError(res.status, await res.text());
        const body = (await res.json()) as { data?: Array<{ id: string }> };
        ok = true;
        details.modelsAvailable = String(body.data?.length ?? 0);
        break;
      }

      case "ollama": {
        const res = await withTimeout(fetch(`${resolveBaseUrl(settings)}/api/tags`));
        if (!res.ok) throw httpError(res.status, await res.text());
        const body = (await res.json()) as { models?: Array<{ name: string }> };
        ok = true;
        details.localModels = String(body.models?.length ?? 0);
        break;
      }
    }

    return {
      ok,
      message: `Connected to ${meta.label} successfully.`,
      latencyMs: Math.round(performance.now() - started),
      details,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

/**
 * Fetches the list of available model IDs for the current provider.
 * Used to populate the model datalist in Settings → AI.
 */
export async function fetchAvailableModels(
  settings: AiSettings,
  apiKey: string | null,
): Promise<string[]> {
  switch (settings.provider) {
    case "openrouter": {
      const res = await withTimeout(fetch("https://openrouter.ai/api/v1/models"));
      if (!res.ok) throw httpError(res.status, await res.text());
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return (body.data ?? []).map((m) => m.id).sort();
    }

    case "openai":
    case "nvidia-nim": {
      const res = await withTimeout(
        fetch(`${resolveBaseUrl(settings)}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      );
      if (!res.ok) throw httpError(res.status, await res.text());
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return (body.data ?? []).map((m) => m.id).sort();
    }

    case "anthropic": {
      const res = await withTimeout(
        fetch(`${resolveBaseUrl(settings)}/v1/models`, {
          headers: {
            "x-api-key": apiKey ?? "",
            "anthropic-version": "2023-06-01",
          },
        }),
      );
      if (!res.ok) throw httpError(res.status, await res.text());
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return (body.data ?? []).map((m) => m.id).sort();
    }

    case "ollama": {
      const res = await withTimeout(fetch(`${resolveBaseUrl(settings)}/api/tags`));
      if (!res.ok) throw httpError(res.status, await res.text());
      const body = (await res.json()) as { models?: Array<{ name: string }> };
      return (body.models ?? []).map((m) => m.name).sort();
    }

    default:
      return [];
  }
}
