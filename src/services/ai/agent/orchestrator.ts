import type { AiSettings, ProjectRecord } from "@/types";
import { getProviderMeta } from "@/services/ai/providers";
import type { ProjectContext } from "@/services/ai/contextService";
import { secretsGet, AI_API_KEY_ID } from "@/services/secrets/secretsService";
import { createSnapshot } from "@/services/projects/projectsService";
import { agentTurn, appendToolResult, type ToolSchema } from "./toolCallFormat";
import { buildTools, type ToolContext, type ToolExecutor } from "./tools";
import { logToolCall } from "./audit";
import {
  architectSystemPrompt,
  buildAgentSystemPrompt,
  reviewerSystemPrompt,
} from "./promptBuilder";

/**
 * VOXEL Agent Orchestrator — the tool-calling loop.
 *
 * Budgets (loop protection, AD-3):
 *  - MAX_STEPS: tool-calling iterations per run
 *  - MAX_WRITES: total write/edit/delete operations per run
 *
 * Policy:
 *  - Rust path guard on every call (layer 1)
 *  - Full audit trail to ai_tool_calls (layer 2)
 *  - UI confirmation for destructive tools (layer 3)
 *  - Automatic snapshot before the first write of a run (AD-7)
 */

const MAX_STEPS = 8;
const MAX_WRITES = 30;

export type AgentPhase = "architect" | "developer" | "reviewer";

export type AgentEvent =
  | { type: "phase"; agent: AgentPhase }
  | { type: "thinking" }
  | {
      type: "tool_start";
      callId: string;
      tool: string;
      summary: string;
      requiresConfirmation: boolean;
    }
  | { type: "tool_result"; callId: string; tool: string; ok: boolean; output: string }
  | { type: "text"; text: string }
  | { type: "snapshot"; label: string };

export interface AgentRunResult {
  text: string;
  toolCalls: number;
  writes: number;
  aborted: boolean;
}

export interface RunAgentOptions {
  settings: AiSettings;
  project: ProjectRecord;
  context: ProjectContext;
  basePath: string;
  sessionId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userText: string;
  onEvent: (event: AgentEvent) => void;
  confirm: (tool: string, summary: string) => Promise<boolean>;
  /** Cooperative cancellation — checked between steps and tools. */
  shouldAbort?: () => boolean;
}

const WRITE_TOOLS = new Set(["write_file", "edit_file", "delete_file", "rename_file", "generate_item_texture"]);

interface LoopOptions extends RunAgentOptions {
  phase: AgentPhase;
  system: string;
  /** tools available in this phase (read-only phases get a filtered set) */
  tools: ToolExecutor[];
  maxSteps: number;
  maxWrites: number;
  /** replaces options.userText — used to hand the plan to the Developer */
  effectiveUserText?: string;
}

async function agentLoop(loop: LoopOptions): Promise<AgentRunResult> {
  const {
    settings,
    project,
    basePath,
    sessionId,
    history,
    userText,
    effectiveUserText,
    onEvent,
    confirm,
    shouldAbort,
    phase,
    system,
    tools,
    maxSteps,
    maxWrites,
  } = loop;

  const meta = getProviderMeta(settings.provider);
  const apiKey = meta.requiresKey ? await secretsGet(AI_API_KEY_ID) : null;

  // Model router: a phase override (if any) only swaps the model id;
  // provider, key and sampling stay with the global configuration.
  const phaseSettings: AiSettings = {
    ...settings,
    model: phaseModelFor(settings, phase),
  };

  const schemas: ToolSchema[] = tools.map((tool) => tool.schema);
  const toolByName = new Map(tools.map((tool) => [tool.schema.name, tool]));

  const ctx: ToolContext = {
    basePath,
    project,
    projectRel: `projects/${project.slug}`,
  };

  const messages: unknown[] = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: effectiveUserText ?? userText },
  ];

  let totalCalls = 0;
  let writes = 0;
  let snapshotTaken = false;
  onEvent({ type: "phase", agent: phase });

  const takeSnapshot = async () => {
    if (snapshotTaken) return;
    try {
      const snapshot = await createSnapshot(
        basePath,
        ctx.projectRel,
        "agent auto-checkpoint",
      );
      onEvent({ type: "snapshot", label: snapshot.label });
    } catch (error) {
      console.warn("Pre-run snapshot failed:", error);
    }
    snapshotTaken = true;
  };

  for (let step = 0; step < maxSteps; step++) {
    if (shouldAbort?.()) {
      const text = "Run stopped by the user.";
      onEvent({ type: "text", text });
      return { text, toolCalls: totalCalls, writes, aborted: true };
    }
    onEvent({ type: "thinking" });

    const turn = await agentTurn(phaseSettings, apiKey, messages, schemas);

    if (turn.toolCalls.length === 0) {
      const text = turn.text.trim();
      if (text) onEvent({ type: "text", text });
      return { text, toolCalls: totalCalls, writes, aborted: false };
    }

    messages.push(turn.rawAssistant);

    // Group results for provider-specific batching (Anthropic requires them
    // in a single user message).
    const results: Array<{ id: string; content: string }> = [];

    for (const call of turn.toolCalls) {
      if (shouldAbort?.()) break;
      totalCalls += 1;
      const tool = toolByName.get(call.name);

      if (!tool) {
        const output = `Unknown tool "${call.name}". Available: ${tools
          .map((t) => t.schema.name)
          .join(", ")}.`;
        results.push({ id: call.id, content: output });
        await logToolCall({
          sessionId,
          tool: call.name,
          args: call.args,
          status: "error",
          resultSummary: output,
        });
        onEvent({
          type: "tool_result",
          callId: call.id,
          tool: call.name,
          ok: false,
          output,
        });
        continue;
      }

      const summary = tool.summarize(call.args);
      onEvent({
        type: "tool_start",
        callId: call.id,
        tool: call.name,
        summary,
        requiresConfirmation: tool.requiresConfirmation === true,
      });

      // Policy layer 3 — destructive confirmation
      if (tool.requiresConfirmation) {
        const approved = await confirm(call.name, summary);
        if (!approved) {
          const output = "Denied by the user — operation cancelled.";
          results.push({ id: call.id, content: output });
          await logToolCall({ sessionId, tool: call.name, args: call.args, status: "denied", resultSummary: output });
          onEvent({ type: "tool_result", callId: call.id, tool: call.name, ok: false, output });
          continue;
        }
      }

      // Read-only phases (architect/reviewer) — enforced here, in code
      if (WRITE_TOOLS.has(call.name) && maxWrites === 0) {
        const output = `The ${phase} phase is read-only — the Developer applies changes.`;
        results.push({ id: call.id, content: output });
        await logToolCall({ sessionId, tool: call.name, args: call.args, status: "denied", resultSummary: output });
        onEvent({ type: "tool_result", callId: call.id, tool: call.name, ok: false, output });
        continue;
      }

      // Write budget + pre-first-write snapshot
      if (WRITE_TOOLS.has(call.name)) {
        if (writes >= maxWrites) {
          const output = `Write budget exhausted (${maxWrites} operations) — stopping writes for this run.`;
          results.push({ id: call.id, content: output });
          await logToolCall({ sessionId, tool: call.name, args: call.args, status: "denied", resultSummary: output });
          onEvent({ type: "tool_result", callId: call.id, tool: call.name, ok: false, output });
          continue;
        }
        await takeSnapshot();
        writes += 1;
      }

      try {
        const output = await tool.execute(call.args, ctx);
        results.push({ id: call.id, content: output });
        await logToolCall({ sessionId, tool: call.name, args: call.args, status: "ok", resultSummary: output });
        onEvent({ type: "tool_result", callId: call.id, tool: call.name, ok: true, output });
      } catch (error) {
        const output = error instanceof Error ? error.message : String(error);
        results.push({ id: call.id, content: `ERROR: ${output}` });
        await logToolCall({ sessionId, tool: call.name, args: call.args, status: "error", resultSummary: output });
        onEvent({ type: "tool_result", callId: call.id, tool: call.name, ok: false, output });
      }
    }

    messages.push(...appendToolResult(turn.provider, turn.rawAssistant, results));
  }

  const text =
    "The run hit the step budget — check the file tree and continue with a new request if needed.";
  onEvent({ type: "text", text });
  return { text, toolCalls: totalCalls, writes, aborted: true };
}

/** Single-agent run (the classic flow) — Developer persona only. */
export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const tools: ToolExecutor[] = buildTools();
  return agentLoop({
    ...options,
    phase: "developer",
    system: buildAgentSystemPrompt(options.context, tools),
    tools,
    maxSteps: MAX_STEPS,
    maxWrites: MAX_WRITES,
  });
}

export interface TaskForceResult extends AgentRunResult {
  plan: string;
  review: string;
}

/**
 * Model routing (briefing §66): which model a task-force phase runs on.
 * An empty override falls back to the global model — routing is opt-in.
 */
export function phaseModelFor(settings: AiSettings, phase: AgentPhase): string {
  return settings.phaseModels?.[phase]?.trim() || settings.model;
}

export const READ_ONLY_TOOLS = new Set([
  "read_file",
  "list_files",
  "search_project",
  "git_status",
  "git_diff",
  "inspect_dependencies",
  "create_snapshot",
  "list_snapshots",
]);

/**
 * Real-time task force (briefing §26-27): the SAME sandboxed tools, three
 * focused agents over the SAME audit trail:
 *   Architect (read-only) → plans the exact request
 *   Developer             → applies the plan (budgets + snapshots + confirm)
 *   Reviewer (read-only)   → audits the diff against the request
 * Nothing is invented: the Developer executes the user's request only,
 * and both read-only phases are enforced by the loop, not by prompts.
 */
export async function runAgentTaskForce(options: RunAgentOptions): Promise<TaskForceResult> {
  const tools: ToolExecutor[] = buildTools();
  const readOnly = tools.filter((tool) => READ_ONLY_TOOLS.has(tool.schema.name));

  // Phase 1 — Architect
  const architect = await agentLoop({
    ...options,
    phase: "architect",
    system: architectSystemPrompt(options.context),
    tools: readOnly,
    maxSteps: 4,
    maxWrites: 0,
  });
  if (architect.aborted) {
    return { ...architect, plan: architect.text, review: "" };
  }

  // Phase 2 — Developer, executing the user's request WITH the plan
  const plan = architect.text.trim();
  const developer = await agentLoop({
    ...options,
    phase: "developer",
    system: buildAgentSystemPrompt(options.context, tools),
    tools,
    maxSteps: MAX_STEPS,
    maxWrites: MAX_WRITES,
    effectiveUserText: plan
      ? `${options.userText}\n\n[Architect plan — follow it, stay inside the request scope]\n${plan}`
      : options.userText,
  });
  if (developer.aborted) {
    return { ...developer, plan, review: "" };
  }

  // Phase 3 — Reviewer (only makes sense if something changed)
  if (developer.writes === 0) {
    const review = "No files were changed — nothing to review.";
    options.onEvent({ type: "phase", agent: "reviewer" });
    options.onEvent({ type: "text", text: review });
    return { ...developer, plan, review };
  }
  const reviewer = await agentLoop({
    ...options,
    phase: "reviewer",
    system: reviewerSystemPrompt(options.context),
    tools: readOnly,
    maxSteps: 3,
    maxWrites: 0,
    effectiveUserText: `Original request: ${options.userText}\n\n[Architect plan]\n${plan}\n\nAudit what the Developer actually changed.`,
  });

  const combined =
    `${developer.text}\n\n---\n**Reviewer report**\n${reviewer.text}`
      .trim();
  return { ...reviewer, text: combined, toolCalls: architect.toolCalls + developer.toolCalls + reviewer.toolCalls, writes: developer.writes, plan, review: reviewer.text };
}
