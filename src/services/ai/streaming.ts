/**
 * AI Provider Layer — streaming chat across provider protocols.
 *
 * One generator-based contract, three wire protocols:
 *  - OpenAI-compatible (OpenRouter, OpenAI, custom endpoints): SSE
 *  - Anthropic: SSE with typed events
 *  - Ollama: NDJSON
 *
 * The Tauri HTTP plugin performs the requests (Rust-side, no browser CORS).
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AiSettings } from "@/types";
import { getProviderMeta } from "@/services/ai/providers";

export type ChatRole = "system" | "user" | "assistant";

export interface ImagePart {
  type: "image";
  mediaType: string;
  /** raw base64, no data: prefix */
  base64: string;
}

export type ChatContent = string | Array<{ type: "text"; text: string } | ImagePart>;

export interface ChatMessage {
  role: ChatRole;
  content: ChatContent;
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export class StreamAborted extends Error {
  constructor() {
    super("Stream aborted");
  }
}

function resolveBaseUrl(settings: AiSettings): string {
  const meta = getProviderMeta(settings.provider);
  return settings.baseUrl?.trim() ? settings.baseUrl.trim() : meta.defaultBaseUrl;
}

/** Plain text content extraction (for rendering stored messages). */
export function contentToText(content: ChatContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

async function readStreamLines(res: { body: ReadableStream<Uint8Array> | null }): Promise<AsyncGenerator<string, void, unknown>> {
  if (!res.body) {
    throw new Error("This response has no readable body");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function* lines(): AsyncGenerator<string, void, unknown> {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          yield line;
        }
      }
      if (buffer.trim().length > 0) yield buffer;
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* stream already closed */
      }
    }
  }
  return lines();
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (OpenRouter / OpenAI / custom)
// ---------------------------------------------------------------------------

async function* streamOpenAiCompatible(
  settings: AiSettings,
  apiKey: string,
  messages: ChatMessage[],
): AsyncGenerator<StreamEvent, void, unknown> {
  const base = resolveBaseUrl(settings);
  const res = await tauriFetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(settings.provider === "openrouter"
        ? { "X-Title": "VOXEL" }
        : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : m.content,
      })),
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Provider returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const lines = await readStreamLines(res);
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      yield { type: "done" };
      return;
    }
    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) yield { type: "delta", text: delta };
    } catch {
      // keep-alive comments or partial frames — skip
    }
  }
  yield { type: "done" };
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

async function* streamAnthropic(
  settings: AiSettings,
  apiKey: string,
  messages: ChatMessage[],
): AsyncGenerator<StreamEvent, void, unknown> {
  const base = resolveBaseUrl(settings);
  const system = contentToText(
    messages.find((m) => m.role === "system")?.content ?? "",
  );
  const chat = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: settings.model,
    max_tokens: settings.maxTokens,
    temperature: settings.temperature,
    messages: chat.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content
          : m.content.map((part) =>
              part.type === "text"
                ? { type: "text", text: part.text }
                : {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: part.mediaType,
                      data: part.base64,
                    },
                  },
            ),
    })),
    stream: true,
  };
  if (system) body.system = system;

  const res = await tauriFetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const lines = await readStreamLines(res);
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    try {
      const parsed = JSON.parse(payload) as {
        type?: string;
        delta?: { type?: string; text?: string };
      };
      if (parsed.type === "content_block_delta" && parsed.delta?.text) {
        yield { type: "delta", text: parsed.delta.text };
      } else if (parsed.type === "message_stop") {
        yield { type: "done" };
        return;
      }
    } catch {
      // event frames without data payloads — skip
    }
  }
  yield { type: "done" };
}

// ---------------------------------------------------------------------------
// Ollama (local)
// ---------------------------------------------------------------------------

async function* streamOllama(
  settings: AiSettings,
  messages: ChatMessage[],
): AsyncGenerator<StreamEvent, void, unknown> {
  const base = resolveBaseUrl(settings);
  const res = await tauriFetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      messages: messages.map((m) => {
        const text = contentToText(m.content);
        const images: ImagePart[] =
          typeof m.content === "string"
            ? []
            : m.content.filter((p): p is ImagePart => p.type === "image");
        return {
          role: m.role,
          content: text,
          ...(images.length > 0
            ? { images: images.map((part) => part.base64) }
            : {}),
        };
      }),
      stream: true,
      options: {
        temperature: settings.temperature,
        num_predict: settings.maxTokens,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const lines = await readStreamLines(res);
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        message?: { content?: string };
        done?: boolean;
      };
      if (parsed.message?.content) {
        yield { type: "delta", text: parsed.message.content };
      }
      if (parsed.done) {
        yield { type: "done" };
        return;
      }
    } catch {
      // skip malformed frames
    }
  }
  yield { type: "done" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function* streamChat(
  settings: AiSettings,
  apiKey: string | null,
  messages: ChatMessage[],
): AsyncGenerator<StreamEvent, void, unknown> {
  const meta = getProviderMeta(settings.provider);
  if (!settings.model.trim()) {
    yield { type: "error", message: "No model configured — set it in Settings → AI." };
    return;
  }
  if (meta.requiresKey && !apiKey) {
    yield { type: "error", message: "No API key stored for this provider." };
    return;
  }

  // Model Router v2 (Phase C): if the primary model fails BEFORE any content
  // arrives (provider outage, model retired), exactly one retry happens on
  // the configured fallback model. Failures mid-stream are real failures —
  // a fallback would duplicate partial content.
  let sawDelta = false;
  let failureMessage: string | null = null;
  const primary = tryStream(settings, apiKey, messages);
  for await (const event of primary) {
    if (event.type === "delta") sawDelta = true;
    if (event.type === "error" && !sawDelta) {
      failureMessage = event.message;
      continue; // hold the error — the fallback gets a chance first
    }
    yield event;
  }
  if (failureMessage !== null && !sawDelta && settings.fallbackModel.trim()) {
    const fallbackSettings: AiSettings = { ...settings, model: settings.fallbackModel.trim() };
    let fallbackSawDelta = false;
    let fallbackFailed = false;
    for await (const event of tryStream(fallbackSettings, apiKey, messages)) {
      if (event.type === "delta") {
        fallbackSawDelta = true;
        yield event;
      } else if (event.type === "error") {
        fallbackFailed = true;
      } else {
        yield event;
      }
    }
    if (!fallbackSawDelta && fallbackFailed) {
      yield { type: "error", message: failureMessage };
    }
    return;
  }
  if (failureMessage !== null && !sawDelta) {
    yield { type: "error", message: failureMessage };
  }
}

async function* tryStream(
  settings: AiSettings,
  apiKey: string | null,
  messages: ChatMessage[],
): AsyncGenerator<StreamEvent, void, unknown> {
  try {
    switch (settings.provider) {
      case "openrouter":
      case "openai":
      case "nvidia-nim":
        yield* streamOpenAiCompatible(settings, apiKey ?? "", messages);
        break;
      case "anthropic":
        yield* streamAnthropic(settings, apiKey ?? "", messages);
        break;
      case "ollama":
        yield* streamOllama(settings, messages);
        break;
    }
  } catch (error) {
    yield {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
