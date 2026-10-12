import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectsStore } from "@/stores/projectsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import {
  ChatPanel,
  type DisplayMessage,
  type TimelineEntry,
  type ToolActivity,
  type ToolStatus,
} from "./ChatPanel";
import { InspectorPanel } from "./InspectorPanel";
import { SpecPreview } from "./SpecPreview";
import {
  appendMessage,
  createSession,
  getLatestSession,
  listMessages,
  type AiSessionRecord,
} from "@/services/ai/sessions";
import {
  buildSystemPrompt,
  loadProjectContext,
  type ProjectContext,
} from "@/services/ai/contextService";
import { notifyDesktop } from "@/services/notifications/notificationService";
import { runAgent, runAgentTaskForce } from "@/services/ai/agent/orchestrator";
import {
  setReferenceStorageBase,
  listReferences,
  importReference,
  readReferenceBase64,
  type ReferenceImage,
} from "@/services/ai/references";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  streamChat,
  type ChatMessage,
  type ImagePart,
} from "@/services/ai/streaming";
import { secretsGet, AI_API_KEY_ID } from "@/services/secrets/secretsService";
import { getProviderMeta } from "@/services/ai/providers";
import { extractSpecProposal } from "./specUtils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Boxes, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface ConfirmRequest {
  tool: string;
  summary: string;
  resolve: (approved: boolean) => void;
}

export function AiCreatorPage() {
  const navigate = useNavigate();
  const projects = useProjectsStore((s) => s.projects);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const hydrateProjects = useProjectsStore((s) => s.hydrate);
  const aiSettings = useSettingsStore((s) => s.settings.ai);
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);

  const [projectId, setProjectId] = useState<string | null>(null);
  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const [session, setSession] = useState<AiSessionRecord | null>(null);
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [agentMode, setAgentMode] = useState(true);
  const [multiAgent, setMultiAgent] = useState(true);
  const [specProposal, setSpecProposal] = useState<string | null>(null);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [changesKey, setChangesKey] = useState(0);

  const streamRef = useRef<AsyncGenerator<unknown, void, unknown> | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    if (!projectsLoaded) void hydrateProjects();
  }, [projectsLoaded, hydrateProjects]);

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projectId, projects]);

  useEffect(() => {
    if (basePath) void setReferenceStorageBase(basePath);
  }, [basePath]);

  // Load session + context + references when the project changes
  useEffect(() => {
    if (!project) {
      setSession(null);
      setContext(null);
      setTimeline([]);
      setReferences([]);
      setSpecProposal(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [latest, ctx, refs] = await Promise.all([
          getLatestSession(project.id),
          loadProjectContext(project),
          listReferences(project.slug).catch(() => []),
        ]);
        if (cancelled) return;
        setContext(ctx);
        setReferences(refs);
        setAttached(new Set());
        if (latest) {
          setSession(latest);
          const history = await listMessages(latest.id);
          if (cancelled) return;
          setTimeline(
            history
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({ role: m.role, content: m.content }) as DisplayMessage),
          );
        } else {
          setSession(null);
          setTimeline([]);
        }
      } catch (error) {
        toast.error("Could not load project context", { description: String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  const ensureSession = useCallback(async (): Promise<AiSessionRecord> => {
    if (session) return session;
    if (!project) throw new Error("No project selected");
    const created = await createSession(project.id, `${project.name} session`);
    setSession(created);
    return created;
  }, [session, project]);

  const textHistory = useCallback(
    (): Array<{ role: "user" | "assistant"; content: string }> =>
      timeline
        .filter((e): e is DisplayMessage => "role" in e)
        .map((m) => ({ role: m.role, content: m.content })),
    [timeline],
  );

  const requireApiKeyAndModel = useCallback(async (): Promise<boolean> => {
    const meta = getProviderMeta(aiSettings.provider);
    if (meta.requiresKey && !(await secretsGet(AI_API_KEY_ID))) {
      toast.error("Configure your API key first", { description: "Settings → AI → API key" });
      navigate("/settings/ai");
      return false;
    }
    if (!aiSettings.model.trim()) {
      toast.error("Choose a model first", { description: "Settings → AI → Model" });
      navigate("/settings/ai");
      return false;
    }
    return true;
  }, [aiSettings.provider, aiSettings.model, navigate]);

/** Composer clip — pick an image, store it as a project reference and
  * attach it to the next chat message as a vision part. */
  const handleAttachImageFromChat = useCallback(async () => {
    if (!project) return;
    const selected = await openFileDialog({
      multiple: false,
      title: "Attach an image to your next message",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    }).catch(() => null);
    if (!selected) return;
    try {
      const relPath = await importReference(project.slug, selected);
      setReferences(await listReferences(project.slug));
      setAttached((prev) => new Set(prev).add(relPath));
      toast.success("Image attached", {
        description: "It will be sent with your next message (vision-capable models).",
      });
    } catch (error) {
      toast.error("Could not attach image", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [project]);

  // -------------------------------------------------------------------------
  // Design chat (streaming, no tools)
  // -------------------------------------------------------------------------
  const runDesignTurn = useCallback(
    async (text: string, activeSession: AiSessionRecord) => {
      if (!project || !context) return;
      const meta = getProviderMeta(aiSettings.provider);
      const apiKey = meta.requiresKey ? await secretsGet(AI_API_KEY_ID) : null;

      const imageParts: ImagePart[] = [];
      for (const relPath of attached) {
        try {
          const { base64, mediaType } = await readReferenceBase64(project.slug, relPath);
          imageParts.push({ type: "image", mediaType, base64 });
        } catch (error) {
          toast.warning(`Could not attach ${relPath.split("/").pop()}`, { description: String(error) });
        }
      }

      setThinking(true);
      abortRef.current = false;

      const history: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt(context) },
        ...textHistory().map((m) => ({ role: m.role, content: m.content })),
      ];
      history.push({
        role: "user",
        content: imageParts.length > 0 ? [{ type: "text", text } as const, ...imageParts] : text,
      });

      let full = "";
      try {
        const generator = streamChat(aiSettings, apiKey, history);
        streamRef.current = generator as AsyncGenerator<unknown, void, unknown>;
        for await (const event of generator) {
          if (abortRef.current) break;
          const typed = event as
            | { type: "delta"; text: string }
            | { type: "done" }
            | { type: "error"; message: string };
          if (typed.type === "delta") {
            full += typed.text;
            setTimeline((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && "role" in last && last.role === "assistant" && last.streaming) {
                next[next.length - 1] = { ...last, content: full, streaming: true };
              } else {
                next.push({ role: "assistant", content: full, streaming: true });
              }
              return next;
            });
          } else if (typed.type === "error") {
            toast.error("AI request failed", { description: typed.message });
            break;
          } else {
            break;
          }
        }
      } catch (error) {
        toast.error("AI request failed", { description: String(error) });
      } finally {
        streamRef.current = null;
        setThinking(false);
        setTimeline((prev) =>
          prev.map((e, i) => {
            const last = i === prev.length - 1;
            if (last && "role" in e && e.role === "assistant") {
              return { ...e, streaming: false };
            }
            return e;
          }),
        );
        if (full.trim()) {
          await appendMessage(activeSession.id, "assistant", full).catch(() => {});
          const proposal = extractSpecProposal(full);
          if (proposal) {
            setSpecProposal(proposal);
            toast.success("Specification proposal ready");
          }
        }
      }
    },
    [project, context, aiSettings, attached, textHistory],
  );

  // -------------------------------------------------------------------------
  // Agent run (tool loop)
  // -------------------------------------------------------------------------
  const refreshContext = useCallback(async () => {
    if (!project) return;
    try {
      setContext(await loadProjectContext(project));
    } catch {
      // context refresh is best-effort
    }
  }, [project]);

  const runAgentTurn = useCallback(
    async (text: string, activeSession: AiSessionRecord) => {
      if (!project || !context || !basePath) return;
      setThinking(true);
      abortRef.current = false;

      const upsertTool = (callId: string, patch: Partial<ToolActivity>) => {
        setTimeline((prev) => {
          const index = prev.findIndex(
            (e) => "callId" in e && e.callId === callId,
          );
          if (index === -1) return prev;
          const next = [...prev];
          next[index] = { ...next[index], ...patch } as TimelineEntry;
          return next;
        });
      };

      try {
        const onAgentEvent = (event: Parameters<
          NonNullable<Parameters<typeof runAgent>[0]["onEvent"]>
        >[0]) => {
          switch (event.type) {
            case "phase":
              setTimeline((prev) => [...prev, { kind: "phase", agent: event.agent }]);
              break;
            case "snapshot":
              setTimeline((prev) => [...prev, { kind: "snapshot", label: event.label }]);
              break;
            case "tool_start":
              setTimeline((prev) => [
                ...prev,
                {
                  kind: "tool",
                  callId: event.callId,
                  tool: event.tool,
                  summary: event.summary,
                  status: "running" as ToolStatus,
                  requiresConfirmation: event.requiresConfirmation,
                },
              ]);
              break;
            case "tool_result":
              upsertTool(event.callId, {
                status: event.ok ? ("ok" as ToolStatus) : ("error" as ToolStatus),
                output: event.output,
              });
              break;
            case "text":
              setTimeline((prev) => [...prev, { role: "assistant", content: event.text }]);
              break;
            case "thinking":
              break;
          }
        };

        const runner = multiAgent ? runAgentTaskForce : runAgent;
        const result = await runner({
          settings: aiSettings,
          project,
          context,
          basePath,
          sessionId: activeSession.id,
          history: textHistory(),
          userText: text,
          shouldAbort: () => abortRef.current,
          onEvent: onAgentEvent,
          confirm: (tool, summary) =>
            new Promise<boolean>((resolve) => {
              setConfirmRequest({ tool, summary, resolve });
            }),
        });

        if (result.text.trim()) {
          await appendMessage(activeSession.id, "assistant", result.text).catch(() => {});
          const proposal = extractSpecProposal(result.text);
          if (proposal) {
            setSpecProposal(proposal);
            toast.success("Specification proposal ready");
          }
          if (result.writes > 0) {
            setChangesKey((k) => k + 1);
            toast.success(`Agent finished — ${result.writes} file operation(s)`, {
              description: "Review the diff in the Changes tab.",
            });
          }
          // Desktop ping (briefing §62) — long task-force runs end while
          // the user is in another tab.
          void notifyDesktop(
            multiAgent ? "Task force finished" : "Agent finished",
            result.writes > 0
              ? `${result.writes} file operation(s) applied to ${project?.name ?? "your project"}`
              : result.text.trim().slice(0, 120) || "Run complete",
          );
        }
      } catch (error) {
        toast.error("Agent run failed", { description: String(error) });
      } finally {
        setThinking(false);
        await refreshContext();
      }
    },
    [project, context, basePath, aiSettings, textHistory, refreshContext],
  );

  const handleSend = useCallback(
    async (text: string) => {
      if (!project || !context || busy) return;
      if (!(await requireApiKeyAndModel())) return;

      const activeSession = await ensureSession();
      setTimeline((prev) => [...prev, { role: "user", content: text }]);
      setBusy(true);
      try {
        await appendMessage(activeSession.id, "user", text).catch(() => {});
        if (agentMode) {
          await runAgentTurn(text, activeSession);
        } else {
          await runDesignTurn(text, activeSession);
        }
      } finally {
        setBusy(false);
      }
    },
    [
      project,
      context,
      busy,
      requireApiKeyAndModel,
      ensureSession,
      agentMode,
      runAgentTurn,
      runDesignTurn,
    ],
  );

  const handleStop = useCallback(() => {
    abortRef.current = true;
    void streamRef.current?.return(undefined);
  }, []);

  const handleNewChat = useCallback(() => {
    setSession(null);
    setTimeline([]);
    setSpecProposal(null);
  }, []);

  if (projectsLoaded && projects.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="rounded-2xl bg-secondary/60 p-4">
          <Boxes className="h-8 w-8 text-muted-foreground/70" />
        </div>
        <div>
          <p className="text-lg font-semibold">The AI Creator needs a project</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            The agent operates on a real project on disk — spec, files, style
            bible and context. Create one first, then come back to build with it.
          </p>
        </div>
        <button
          className="btn-ghost text-sm text-primary hover:underline"
          onClick={() => useUiStore.getState().setCreateWizardOpen(true)}
        >
          Create project
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-border/60 bg-card/30 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <Select
            value={projectId ?? undefined}
            onValueChange={(v) => {
              setProjectId(v);
              setSession(null);
            }}
          >
            <SelectTrigger className="h-8 w-64">
              <SelectValue placeholder="Select project…" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {project && (
            <Badge variant="secondary">
              {project.loader} · MC {project.minecraft_version}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {context?.projectSpecParsed ? (
            <Badge variant="success">spec loaded</Badge>
          ) : (
            <Badge variant="warning">no spec yet</Badge>
          )}
        </div>
      </div>

      {/* 3 columns */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_300px]">
        <ChatPanel
          messages={timeline}
          busy={busy || thinking}
          thinking={thinking}
          agentMode={agentMode}
          onToggleAgentMode={setAgentMode}
          multiAgent={multiAgent}
          onToggleMultiAgent={setMultiAgent}
          attachedCount={attached.size}
          hasProject={project !== null}
          onSend={handleSend}
          onAttachImage={handleAttachImageFromChat}
          onStop={handleStop}
          onNewChat={handleNewChat}
        />
        <SpecPreview
          context={context}
          proposal={specProposal}
          projectSlug={project?.slug ?? null}
          changesRefreshKey={changesKey}
          onSaved={() => {
            void refreshContext();
            setChangesKey((k) => k + 1);
          }}
        />
        <InspectorPanel
          context={context}
          projectSlug={project?.slug ?? null}
          references={references}
          attached={attached}
          onReferencesChanged={async (next) => {
            setAttached(next);
            if (project) setReferences(await listReferences(project.slug));
          }}
          onQuickPrompt={(prompt) => {
            void handleSend(prompt);
          }}
        />
      </div>

      {/* Destructive-tool confirmation (policy layer 3) */}
      <Dialog
        open={confirmRequest !== null}
        onOpenChange={(open) => {
          if (!open && confirmRequest) {
            confirmRequest.resolve(false);
            setConfirmRequest(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              Confirm {confirmRequest?.tool}?
            </DialogTitle>
            <DialogDescription>
              The agent wants to run a destructive operation on the project.
              The working tree is snapshotted, so restores are always possible.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg border border-border/70 bg-card/60 px-3 py-2 font-mono text-xs">
            {confirmRequest?.summary}
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                confirmRequest?.resolve(false);
                setConfirmRequest(null);
              }}
            >
              Deny
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                confirmRequest?.resolve(true);
                setConfirmRequest(null);
              }}
            >
              Allow once
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
