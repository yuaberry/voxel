import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AiSettings } from "@/types";
import { getProviderMeta } from "@/services/ai/providers";
import type { ChatMessage } from "@/services/ai/streaming";

/**
 * Tool-calling wire format per provider — request building and response
 * parsing for the agent loop (non-streaming; tools need complete turns).
 */

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentTurnResponse {
  /** Assistant text in this turn (may be empty when only tools are called). */
  text: string;
  toolCalls: ParsedToolCall[];
  /**
   * Provider-native assistant message to append to history verbatim
   * (Anthropic requires the original content blocks; OpenAI-compat keeps
   * the tool_calls structure).
   */
  rawAssistant: unknown;
  /** Provider id the turn came from — history must stay homogeneous. */
  provider: AiSettings["provider"];
}

function resolveBaseUrl(settings: AiSettings): string {
  const meta = getProviderMeta(settings.provider);
  return settings.baseUrl?.trim() ? settings.baseUrl.trim() : meta.defaultBaseUrl;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await tauriFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Provider returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (OpenRouter / OpenAI / custom)
// ---------------------------------------------------------------------------

function openAiTools(tools: ToolSchema[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

async function turnOpenAiCompatible(
  settings: AiSettings,
  apiKey: string,
  messages: unknown[],
  tools: ToolSchema[],
): Promise<AgentTurnResponse> {
  const base = resolveBaseUrl(settings);
  const data = await postJson(
    `${base}/chat/completions`,
    {
      Authorization: `Bearer ${apiKey}`,
      ...(settings.provider === "openrouter" ? { "X-Title": "VOXEL" } : {}),
    },
    {
      model: settings.model,
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      tools: openAiTools(tools),
      tool_choice: "auto",
    },
  );

  const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = (choice?.message ?? {}) as Record<string, unknown>;
  const rawCalls = (message.tool_calls ?? []) as Array<Record<string, unknown>>;

  const toolCalls: ParsedToolCall[] = rawCalls.map((call) => {
    const function_ = (call.function ?? {}) as Record<string, unknown>;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(String(function_.arguments ?? "{}")) as Record<string, unknown>;
    } catch {
      args = {};
    }
    return {
      id: String(call.id ?? crypto.randomUUID()),
      name: String(function_.name ?? ""),
      args,
    };
  });

  return {
    text: typeof message.content === "string" ? message.content : "",
    toolCalls,
    rawAssistant: message,
    provider: settings.provider,
  };
}

function openAiToolResult(toolCallId: string, content: string): unknown {
  return { role: "tool", tool_call_id: toolCallId, content };
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

async function turnAnthropic(
  settings: AiSettings,
  apiKey: string,
  messages: unknown[],
  tools: ToolSchema[],
): Promise<AgentTurnResponse> {
  const base = resolveBaseUrl(settings);
  const normalized = messages as Array<Record<string, unknown>>;
  const system = normalized
    .filter((m) => m.role === "system")
    .map((m) => String((m as { content?: unknown }).content))
    .join("\n\n");
  const chat = normalized.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: settings.model,
    max_tokens: settings.maxTokens,
    temperature: settings.temperature,
    messages: chat,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    })),
  };
  if (system) body.system = system;

  const data = await postJson(
    `${base}/v1/messages`,
    { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body,
  );

  const content = (data.content ?? []) as Array<Record<string, unknown>>;
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("");
  const toolCalls: ParsedToolCall[] = content
    .filter((block) => block.type === "tool_use")
    .map((block) => ({
      id: String(block.id ?? crypto.randomUUID()),
      name: String(block.name ?? ""),
      args: (block.input ?? {}) as Record<string, unknown>,
    }));

  return {
    text,
    toolCalls,
    rawAssistant: { role: "assistant", content },
    provider: "anthropic",
  };
}

function anthropicToolResult(results: Array<{ id: string; content: string }>): unknown {
  return {
    role: "user",
    content: results.map((result) => ({
      type: "tool_result",
      tool_use_id: result.id,
      content: result.content,
    })),
  };
}

// ---------------------------------------------------------------------------
// Ollama (local)
// ---------------------------------------------------------------------------

async function turnOllama(
  settings: AiSettings,
  messages: unknown[],
  tools: ToolSchema[],
): Promise<AgentTurnResponse> {
  const base = resolveBaseUrl(settings);
  const data = await postJson(
    `${base}/api/chat`,
    {},
    {
      model: settings.model,
      messages: (messages as ChatMessage[]).map((m) => ({
        role: m.role,
        // Ollama accepts plain-string content; tool history is normalized elsewhere
        content:
          typeof m.content === "string"
            ? m.content
            : "[(multimodal content omitted in agent turns)]",
      })),
      tools: openAiTools(tools),
      stream: false,
      options: {
        temperature: settings.temperature,
        num_predict: settings.maxTokens,
      },
    },
  );

  const message = (data.message ?? {}) as Record<string, unknown>;
  const rawCalls = (message.tool_calls ?? []) as Array<Record<string, unknown>>;
  const toolCalls: ParsedToolCall[] = rawCalls.map((call, index) => {
    const function_ = (call.function ?? {}) as Record<string, unknown>;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(String(function_.arguments ?? "{}")) as Record<string, unknown>;
    } catch {
      args = {};
    }
    return {
      id: String(call.id ?? `ollama-${index}`),
      name: String(function_.name ?? ""),
      args,
    };
  });

  return {
    text: typeof message.content === "string" ? message.content : "",
    toolCalls,
    rawAssistant: message,
    provider: "ollama",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function agentTurn(
  settings: AiSettings,
  apiKey: string | null,
  messages: unknown[],
  tools: ToolSchema[],
): Promise<AgentTurnResponse> {
  switch (settings.provider) {
    case "openrouter":
    case "openai":
    case "nvidia-nim":
      return turnOpenAiCompatible(settings, apiKey ?? "", messages, tools);
    case "anthropic":
      return turnAnthropic(settings, apiKey ?? "", messages, tools);
    case "ollama":
      return turnOllama(settings, messages, tools);
  }
}

/** Appends a tool result to the message history, provider-aware. */
export function appendToolResult(
  provider: AiSettings["provider"],
  rawAssistant: unknown,
  results: Array<{ id: string; content: string }>,
): unknown[] {
  switch (provider) {
    case "anthropic":
      return [rawAssistant, anthropicToolResult(results)];
    case "ollama":
    case "openrouter":
    case "openai":
    default:
      return [rawAssistant, ...results.map((r) => openAiToolResult(r.id, r.content))];
  }
}
