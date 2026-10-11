import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  FileDiff,
  ImagePlus,
  Loader2,
  Search,
  ShieldCheck,
  Square,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Timeline entry rendered in the chat column. */
export type ToolStatus = "running" | "ok" | "error" | "denied";

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export interface ToolActivity {
  kind: "tool";
  callId: string;
  tool: string;
  summary: string;
  status: ToolStatus;
  output?: string;
  requiresConfirmation?: boolean;
}

export interface SnapshotActivity {
  kind: "snapshot";
  label: string;
}

export interface PhaseActivity {
  kind: "phase";
  agent: "architect" | "developer" | "reviewer";
}

export type TimelineEntry = DisplayMessage | ToolActivity | SnapshotActivity | PhaseActivity;

export const AGENT_PHASE_META: Record<
  PhaseActivity["agent"],
  { label: string; color: string; description: string }
> = {
  architect: {
    label: "Architect",
    color: "text-cyan-300 border-cyan-400/40 bg-cyan-400/10",
    description: "Analyzing the request and planning — read-only",
  },
  developer: {
    label: "Developer",
    color: "text-violet-300 border-violet-400/40 bg-violet-400/10",
    description: "Applying the plan with the sandboxed tools",
  },
  reviewer: {
    label: "Reviewer",
    color: "text-amber-300 border-amber-400/40 bg-amber-400/10",
    description: "Auditing the diff — read-only",
  },
};

interface Props {
  messages: TimelineEntry[];
  busy: boolean;
  thinking: boolean;
  agentMode: boolean;
  onToggleAgentMode: (enabled: boolean) => void;
  /** Task-force pipeline: Architect → Developer → Reviewer */
  multiAgent: boolean;
  onToggleMultiAgent: (enabled: boolean) => void;
  attachedCount: number;
  hasProject: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
  onNewChat: () => void;
  /** Attach an image to the next message (composer clip button) */
  onAttachImage: () => Promise<void>;
}

export function ChatPanel({
  messages,
  busy,
  thinking,
  agentMode,
  onToggleAgentMode,
  multiAgent,
  onToggleMultiAgent,
  attachedCount,
  hasProject,
  onSend,
  onStop,
  onNewChat,
  onAttachImage,
}: Props) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const canSend = hasProject && draft.trim().length > 0 && !busy;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        const text = draft;
        setDraft("");
        void onSend(text);
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border/60">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Creator
        </span>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2" title="Agent mode: the AI can read and modify project files through sandboxed tools">
            <span className={cn("text-[11px] font-medium", agentMode ? "text-primary" : "text-muted-foreground")}>
              Agent mode
            </span>
            <Switch checked={agentMode} onCheckedChange={onToggleAgentMode} />
          </label>
          <button
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={onNewChat}
            title="Start a fresh conversation (history stays in the database)"
          >
            New chat
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <EmptyChat hasProject={hasProject} agentMode={agentMode} />
        ) : (
          <div className="space-y-4">
            {messages.map((entry, index) => {
              if ("kind" in entry) {
                if (entry.kind === "tool") {
                  return <ToolCard key={`${entry.callId}-${index}`} activity={entry} />;
                }
                if (entry.kind === "phase") {
                  const meta = AGENT_PHASE_META[entry.agent];
                  return (
                    <div key={`phase-${index}`} className="flex justify-center animate-card-rise">
                      <span
                        className={
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold " +
                          meta.color
                        }
                        title={meta.description}
                      >
                        <Bot className="h-3 w-3" />
                        {meta.label} agent {meta.description}
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={`snap-${index}`} className="flex justify-center">
                    <Badge variant="secondary" className="gap-1 py-1">
                      <ShieldCheck className="h-3 w-3" />
                      snapshot {entry.label} created
                    </Badge>
                  </div>
                );
              }
              const message = entry as DisplayMessage;
              return (
                <div
                  key={index}
                  className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed",
                      message.role === "user"
                        ? "bg-primary/15 text-foreground"
                        : "border border-border/60 bg-card/70 text-foreground/95",
                    )}
                  >
                    {message.role === "user" ? (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <div className="chat-md">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        {message.streaming && (
                          <span className="mt-1 inline-block h-4 w-1.5 animate-pulse-soft bg-primary align-middle" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {thinking && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/70 px-4 py-2.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  {agentMode ? "Agent is planning its steps…" : "Generating…"}
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border/60 p-3">
        {agentMode && (
          <div className="mb-2 flex items-center gap-1.5">
            <Badge variant="default" className="gap-1">
              <Wrench className="h-3 w-3" /> 12 sandboxed tools active
            </Badge>
            <Badge variant="outline">auto-snapshot before writes</Badge>
            <button
              type="button"
              onClick={() => onToggleMultiAgent(!multiAgent)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors",
                multiAgent
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-primary/30",
              )}
              title="Task force: Architect plans, Developer applies, Reviewer audits — same sandboxed tools"
            >
              {multiAgent ? "✦ Task force: 3 agents ON" : "✦ Task force OFF (single agent)"}
            </button>
          </div>
        )}
        <div className={attachedCount > 0 ? "pb-2" : "pb-0"}>
          {attachedCount > 0 && (
            <Badge variant="secondary">
              <ImagePlus className="h-3 w-3" />
              {attachedCount} reference{attachedCount === 1 ? "" : "s"} attached — will be sent with your next message
            </Badge>
          )}
          <button
            type="button"
            disabled={!hasProject}
            onClick={() => void onAttachImage()}
            title="Attach an image to your next message (vision)"
            className={
              "mt-1.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors " +
              (hasProject
                ? "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                : "text-muted-foreground/40")
            }
          >
            <ImagePlus className="h-3.5 w-3.5" />
            Attach image
          </button>
        </div>
        <div className="relative">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!hasProject || busy}
            placeholder={
              !hasProject
                ? "Select a project first"
                : agentMode
                  ? "Tell the agent what to build… e.g. \"add a Voidcutter sword with a recipe\""
                  : "Describe what to build… (Enter to send, Shift+Enter for a new line)"
            }
            rows={3}
            className="w-full resize-none rounded-lg border border-input bg-background/60 px-3 py-2.5 pr-12 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <div className="absolute bottom-2.5 right-2.5">
            {busy ? (
              <Button size="icon" variant="secondary" className="h-8 w-8" onClick={onStop} title="Stop">
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                variant={canSend ? "gradient" : "secondary"}
                className="h-8 w-8"
                disabled={!canSend}
                onClick={() => {
                  const text = draft;
                  setDraft("");
                  void onSend(text);
                }}
                title="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  read_file: Search,
  write_file: Wrench,
  edit_file: Wrench,
  delete_file: X,
  rename_file: FileDiff,
  create_directory: Terminal,
  list_files: Search,
  search_project: Search,
  inspect_dependencies: Terminal,
  git_status: FileDiff,
  git_diff: FileDiff,
  create_snapshot: ShieldCheck,
  list_snapshots: ShieldCheck,
};

function ToolCard({ activity }: { activity: ToolActivity }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[activity.tool] ?? Bot;

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "w-[85%] overflow-hidden rounded-xl border text-xs",
          activity.status === "running" && "border-primary/40 bg-primary/5",
          activity.status === "ok" && "border-emerald-500/25 bg-emerald-500/5",
          activity.status === "error" && "border-red-500/30 bg-red-500/5",
          activity.status === "denied" && "border-amber-500/30 bg-amber-500/5",
        )}
      >
        <button
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
              activity.status === "ok" && "bg-emerald-500/15 text-emerald-400",
              activity.status === "error" && "bg-red-500/15 text-red-400",
              activity.status === "denied" && "bg-amber-500/15 text-amber-400",
              activity.status === "running" && "bg-primary/15 text-primary",
            )}
          >
            {activity.status === "running" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : activity.status === "ok" ? (
              <Check className="h-3 w-3" />
            ) : activity.status === "denied" ? (
              <X className="h-3 w-3" />
            ) : (
              <X className="h-3 w-3" />
            )}
          </span>
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90">
            <span className="text-muted-foreground">{activity.tool}</span>{" "}
            {activity.summary}
          </span>
          {activity.output && (
            <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground/50">
              {open ? "hide" : "output"}
            </span>
          )}
        </button>
        {open && activity.output && (
          <pre className="max-h-48 overflow-auto border-t border-border/50 bg-background/60 px-3.5 py-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {activity.output}
          </pre>
        )}
      </div>
    </div>
  );
}

function EmptyChat({ hasProject, agentMode }: { hasProject: boolean; agentMode: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-xl bg-secondary/60 p-3">
        {agentMode ? (
          <Bot className="h-6 w-6 text-muted-foreground/60" />
        ) : (
          <Sparkles className="h-6 w-6 text-muted-foreground/60" />
        )}
      </div>
      {hasProject ? (
        <>
          <p className="text-sm font-medium text-foreground/90">
            {agentMode
              ? "The agent edits the project with you"
              : "Design with the project as context"}
          </p>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            {agentMode
              ? "Every read and write passes through the Rust sandbox, is audited and auto-snapshotted. Try: "
              : "The AI reads this project's spec, style bible and files before answering. Try: "}
            <span className="text-primary/90">
              {agentMode
                ? "\"Add a Voidcutter sword: item, model, lang and recipe\""
                : "\"Design the project specification for a dark medieval RPG\""}
            </span>
          </p>
        </>
      ) : (
        <p className="max-w-xs text-xs text-muted-foreground">Select a project above to start.</p>
      )}
    </div>
  );
}
