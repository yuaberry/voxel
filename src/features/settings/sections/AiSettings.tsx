import { useEffect, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useSettingsStore } from "@/stores/settingsStore";
import { AI_PROVIDERS, getProviderMeta } from "@/services/ai/providers";
import {
  fetchAvailableModels,
  testAiConnection,
} from "@/services/ai/connectionService";
import {
  AI_API_KEY_ID,
  secretsBackendInfo,
  secretsDelete,
  secretsHas,
  secretsSet,
} from "@/services/secrets/secretsService";
import { Field, SectionHeader } from "../SettingsBits";
import { cn } from "@/lib/utils";
import type { AiConnectionTestResult, SecretBackendInfo } from "@/types";

export function AiSettings() {
  const ai = useSettingsStore((s) => s.settings.ai);
  const update = useSettingsStore((s) => s.update);

  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [backend, setBackend] = useState<SecretBackendInfo | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);

  const meta = getProviderMeta(ai.provider);

  const refreshKeyState = () => {
    secretsHas(AI_API_KEY_ID).then(setHasKey).catch(() => setHasKey(false));
    secretsBackendInfo().then(setBackend).catch(() => setBackend(null));
  };

  useEffect(refreshKeyState, [ai.provider]);

  const handleSaveKey = async () => {
    const value = keyDraft.trim();
    if (!value) {
      toast.info("Nothing to save — enter a key first");
      return;
    }
    try {
      const result = await secretsSet(AI_API_KEY_ID, value);
      setKeyDraft("");
      setHasKey(true);
      setTestResult(null);
      toast.success("API key stored securely", {
        description:
          result.backend === "os-keyring"
            ? "Saved in your operating system's credential manager."
            : "OS keyring unavailable — saved to a permission-restricted local file.",
      });
    } catch (error) {
      toast.error("Failed to store API key", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleRemoveKey = async () => {
    try {
      await secretsDelete(AI_API_KEY_ID);
      setHasKey(false);
      setKeyDraft("");
      setTestResult(null);
      toast.success("API key removed");
    } catch (error) {
      toast.error("Failed to remove key", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { secretsGet } = await import("@/services/secrets/secretsService");
      const key = await secretsGet(AI_API_KEY_ID);
      const result = await testAiConnection(ai, key);
      setTestResult(result);
      if (result.ok) {
        toast.success(result.message, { description: `${result.latencyMs} ms round trip` });
      } else {
        toast.error("Connection failed", { description: result.message });
      }
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async (silent = false) => {
    setFetchingModels(true);
    try {
      const { secretsGet } = await import("@/services/secrets/secretsService");
      const key = await secretsGet(AI_API_KEY_ID);
      const list = await fetchAvailableModels(ai, key);
      setModels(list);
      if (!silent) {
        toast.success(`Fetched ${list.length} models`, {
          description: "Pick one from the model field dropdown.",
        });
      }
    } catch (error) {
      if (!silent) {
        toast.error("Could not fetch models", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setFetchingModels(false);
    }
  };

  // Live list as soon as credentials allow it — picking beats typing
  useEffect(() => {
    void handleFetchModels(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.provider, ai.baseUrl]);

  return (
    <section>
      <SectionHeader
        title="AI"
        description="Provider-agnostic by design — bring your own model, cloud or local."
      />

      {/* Provider selection */}
      <Field label="Provider" hint="Keys are stored in the OS credential manager — never in the database or Git.">
        <div className="grid gap-3 sm:grid-cols-2">
          {AI_PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              onClick={() =>
                update("ai", { provider: provider.id }).catch(() =>
                  toast.error("Could not save provider"),
                )
              }
              className={cn(
                "rounded-lg border p-4 text-left transition-colors",
                ai.provider === provider.id
                  ? "border-primary/60 bg-primary/10"
                  : "border-border/70 bg-card/40 hover:border-primary/30",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{provider.label}</span>
                {ai.provider === provider.id && <Badge>Active</Badge>}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {provider.description}
              </p>
            </button>
          ))}
        </div>
      </Field>

      {/* Model */}
      <Field
        label="Model"
        hint="The live list loads automatically — just pick one. You can still type a custom ID."
      >
        <div className="flex max-w-md flex-col gap-2">
          <Button
            variant="secondary"
            className="justify-between"
            onClick={() => {
              if (models.length === 0) void handleFetchModels();
              setModelPickerOpen(true);
            }}
          >
            <span className="truncate font-mono text-xs">
              {ai.model || "Choose a model…"}
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              {fetchingModels ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ChevronsUpDown className="h-3.5 w-3.5" />
              )}
            </span>
          </Button>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{models.length} models available</span>
            <button
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => void handleFetchModels()}
              disabled={fetchingModels}
            >
              <RefreshCw className={"h-3 w-3 " + (fetchingModels ? "animate-spin" : "")} />
              Refresh
            </button>
          </div>
          <Input
            placeholder={`…or type an ID (${meta.modelPlaceholder})`}
            value={ai.model}
            list="voxel-models-list"
                onChange={(e) => void update("ai", { model: e.target.value }).catch(() => {})}
            className="font-mono text-xs"
          />
        </div>

        <Dialog open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
          <DialogContent className="flex max-w-md flex-col gap-0 p-0">
            <DialogHeader className="border-b border-border/70 px-4 py-3">
              <DialogTitle className="text-sm">Choose a model</DialogTitle>
              <DialogDescription className="text-[11px]">
                {meta.label} live list — search and click to use it.
              </DialogDescription>
            </DialogHeader>
            <Command shouldFilter={true} className="pt-0">
              <div className="flex items-center gap-2 border-b border-border/70 px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <CommandInput
                  placeholder="Search models…"
                  className="border-0 ring-0 focus-visible:ring-0"
                />
              </div>
              <CommandList className="max-h-72">
                <CommandEmpty>No model matches.</CommandEmpty>
                <CommandGroup>
                  {models.map((id) => (
                    <CommandItem
                      key={id}
                      value={id}
                      onSelect={() => {
                        void update("ai", { model: id }).catch(() => {});
                        setModelPickerOpen(false);
                      }}
                      className="font-mono text-xs"
                    >
                      <Check
                        className={
                          "mr-2 h-3.5 w-3.5 " +
                          (ai.model === id ? "opacity-100" : "opacity-0")
                        }
                      />
                      {id}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </DialogContent>
        </Dialog>
      </Field>

      {/* Model suggestions shared by the main input and the phase router */}
      <datalist id="voxel-models-list">
        {models.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>

      {/* Model routing — task force (briefing §66) */}
      <Field
        label="Task force model routing"
        hint="Optional per-phase models — e.g. a stronger Architect with a fast Reviewer. Empty uses the main model above (same provider & key)."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              { key: "architect", label: "Architect" },
              { key: "developer", label: "Developer" },
              { key: "reviewer", label: "Reviewer" },
            ] as const
          ).map(({ key, label }) => (
            <label key={key} className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </span>
              <input
                list="voxel-models-list"
                className="h-9 w-full rounded-md border border-border bg-card/60 px-2.5 text-sm outline-none transition-colors focus:border-primary"
                placeholder={ai.model || "uses main model"}
                value={ai.phaseModels?.[key] ?? ""}
                onChange={(e) =>
                  void update("ai", {
                    phaseModels: { ...ai.phaseModels, [key]: e.target.value },
                  }).catch(() => {})
                }
              />
            </label>
          ))}
        </div>
      </Field>

      {/* API key */}
      {meta.requiresKey && (
        <Field
          label="API key"
          hint={
            hasKey
              ? backend?.backend === "os-keyring"
                ? "A key is stored in the OS credential manager."
                : "A key is stored in a permission-restricted local file (OS keyring unavailable)."
              : `Paste your ${meta.label} key. It never leaves this machine.`
          }
        >
          <div className="max-w-md space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  type={showKey ? "text" : "password"}
                  className="pl-9 pr-10 font-mono text-xs"
                  placeholder={hasKey ? "•••••••••••••••• (stored)" : meta.keyHint}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                />
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                  onClick={() => setShowKey((v) => !v)}
                  type="button"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={() => void handleSaveKey()} disabled={!keyDraft.trim()}>
                Save
              </Button>
              {hasKey && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void handleRemoveKey()}
                  title="Remove stored key"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            {hasKey && (
              <Badge variant="success">
                Key stored{backend ? ` · ${backend.backend}` : ""}
              </Badge>
            )}
          </div>
        </Field>
      )}

      {/* Base URL */}
      {meta.supportsBaseUrl && (
        <Field
          label="Base URL"
          hint={`Custom endpoint support (any ${meta.label}-compatible API). Leave empty for the official API.`}
        >
          <div className="max-w-md">
            <Input
              className="font-mono text-xs"
              placeholder={meta.defaultBaseUrl}
              value={ai.baseUrl}
              onChange={(e) => void update("ai", { baseUrl: e.target.value }).catch(() => {})}
            />
          </div>
        </Field>
      )}

      <Separator className="my-2" />

      {/* Sampling */}
      <Field
        label={`Temperature — ${ai.temperature.toFixed(1)}`}
        hint="Lower is deterministic and precise; higher is creative. Code generation works best between 0.2 and 0.8."
      >
        <div className="max-w-md">
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={ai.temperature}
            onChange={(e) =>
              void update("ai", { temperature: Number(e.target.value) }).catch(() => {})
            }
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-[hsl(var(--primary))]"
          />
        </div>
      </Field>

      <Field
        label="Max tokens"
        hint="Upper bound for a single AI response. Generation is capped by the provider anyway."
      >
        <div className="max-w-md">
          <Input
            type="number"
            min={256}
            max={200000}
            value={ai.maxTokens}
            onChange={(e) =>
              void update("ai", { maxTokens: Number(e.target.value) }).catch(() => {})
            }
          />
        </div>
      </Field>

      <Separator className="my-2" />

      {/* Connection test */}
      <Field
        label="Connection test"
        hint="Performs a live request against the configured provider with your stored key."
      >
        <div className="space-y-3">
          <Button
            variant="gradient"
            onClick={() => void handleTest()}
            disabled={testing}
          >
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plug className="h-4 w-4" />
            )}
            {testing ? "Testing…" : "Test connection"}
          </Button>

          {testResult && (
            <div
              className={cn(
                "rounded-lg border p-4 text-sm",
                testResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-red-500/30 bg-red-500/5",
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">
                  {testResult.ok ? "Connected" : "Failed"}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {testResult.latencyMs} ms
                </span>
              </div>
              <p
                className={cn(
                  "mt-1 font-mono text-xs leading-relaxed",
                  testResult.ok ? "text-emerald-300/80" : "text-red-300/80",
                )}
              >
                {testResult.message}
              </p>
              {testResult.details && (
                <div className="mt-2 space-y-1">
                  {Object.entries(testResult.details).map(([k, v]) => (
                    <p key={k} className="text-xs text-muted-foreground">
                      <span className="font-mono">{k}</span>: {v}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Field>

      <div className="pt-2">
        <Label className="text-[11px] text-muted-foreground/70">
          Streaming chat, tool-calling and the VOXEL Agent arrive in Phases 2–4,
          building on this exact configuration.
        </Label>
      </div>
    </section>
  );
}
