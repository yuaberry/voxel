import type { AiProviderId } from "@/types";

export interface AiProviderMeta {
  id: AiProviderId;
  label: string;
  description: string;
  requiresKey: boolean;
  keyHint: string;
  modelPlaceholder: string;
  defaultBaseUrl: string;
  supportsBaseUrl: boolean;
}

export const AI_PROVIDERS: AiProviderMeta[] = [
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    description:
      "NVIDIA NIM APIs (integrate.api.nvidia.com) or a self-hosted NIM microservice — OpenAI-compatible.",
    requiresKey: true,
    keyHint: "nvapi-…",
    modelPlaceholder: "e.g. meta/llama-3.1-405b-instruct — fetch the live list",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    supportsBaseUrl: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Aggregate access to hundreds of models with a single key.",
    requiresKey: true,
    keyHint: "sk-or-v1-…",
    modelPlaceholder: "e.g. anthropic/claude-sonnet-4 — use Fetch Models for the live list",
    defaultBaseUrl: "",
    supportsBaseUrl: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "Direct OpenAI API, or any OpenAI-compatible endpoint.",
    requiresKey: true,
    keyHint: "sk-…",
    modelPlaceholder: "e.g. gpt-4o-mini — use Fetch Models for the live list",
    defaultBaseUrl: "https://api.openai.com/v1",
    supportsBaseUrl: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models via the Anthropic API.",
    requiresKey: true,
    keyHint: "sk-ant-…",
    modelPlaceholder: "e.g. claude-sonnet-4 — use Fetch Models for the live list",
    defaultBaseUrl: "https://api.anthropic.com",
    supportsBaseUrl: true,
  },
  {
    id: "ollama",
    label: "Ollama",
    description: "Fully local models running on your machine. No API key.",
    requiresKey: false,
    keyHint: "",
    modelPlaceholder: "e.g. llama3.2 — use Fetch Models for the local list",
    defaultBaseUrl: "http://localhost:11434",
    supportsBaseUrl: true,
  },
];

export function getProviderMeta(id: AiProviderId): AiProviderMeta {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}
