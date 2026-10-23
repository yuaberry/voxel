import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { toast } from "sonner";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, Save, Sparkles, Trash2, Upload, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  ALL_KINDS,
  compileLogicGraph,
  kindLabel,
  kindRole,
  requiredParams,
  validateGraph,
  type LogicGraph,
  type LogicNode,
  type LogicNodeKind,
} from "@/services/logic/logicGraph";
import {
  installLogicGraph,
  saveLogicGraph,
  designLogicGraphWithAi,
} from "@/services/logic/logicGraphService";
import { cn } from "@/lib/utils";

/**
 * VOXEL Visual Logic Studio — the node graph with REAL semantics: every
 * node maps to proven vanilla-datapack patterns and the compiler turns the
 * graph into actual mcfunction files. The canvas is React Flow; the truth
 * is the generator you can read in the Preview tab.
 */

type LogicData = {
  kind: LogicNodeKind;
  params: Record<string, string | number>;
  errors: string[];
};
type LogicFlowNode = Node<LogicData>;

const ROLE_STYLE: Record<"event" | "condition" | "action", string> = {
  event: "border-cyan-400/50 bg-cyan-400/10",
  condition: "border-amber-400/50 bg-amber-400/10",
  action: "border-violet-400/50 bg-violet-400/10",
};

function LogicNodeCard({ data, selected }: NodeProps<LogicFlowNode>) {
  const role = kindRole(data.kind);
  return (
    <div
      className={cn(
        "min-w-40 max-w-56 rounded-xl border-2 px-3 py-2 text-left shadow-lg backdrop-blur transition-colors",
        ROLE_STYLE[role],
        selected && "ring-2 ring-primary",
        data.errors.length > 0 && "border-destructive",
      )}
    >
      <Handle type="target" position={Position.Left} />
      <p className="text-[11px] font-semibold text-foreground">
        {kindLabel(data.kind)}
        {data.errors.length > 0 && (
          <span className="ml-1 text-destructive" title={data.errors.join("; ")}>
            ●
          </span>
        )}
      </p>
      <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
        {Object.entries(data.params)
          .slice(0, 2)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(" · ") || "(click to configure)"}
      </p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { logic: LogicNodeCard };

function PaletteButton({ kind, onAdd }: { kind: LogicNodeKind; onAdd: (kind: LogicNodeKind) => void }) {
  const role = kindRole(kind);
  return (
    <button
      type="button"
      onClick={() => onAdd(kind)}
      className={cn(
        "w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors hover:border-primary/50",
        ROLE_STYLE[role],
      )}
    >
      <span className="text-[8px] uppercase tracking-wide text-muted-foreground">{role}</span>
      <br />
      {kindLabel(kind)}
    </button>
  );
}

function Canvas() {
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const [nodes, setNodes, onNodesChange] = useNodesState<LogicFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graphName, setGraphName] = useState("my_logic");
  const [description, setDescription] = useState("");
  const [servers, setServers] = useState<{ slug: string; name: string }[]>([]);
  const [targetServer, setTargetServer] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!basePath) return;
    invoke<{ slug: string; name: string }[]>("servers_scan_disk", { basePath })
      .then((list) => {
        setServers(list);
        if (list.length > 0) setTargetServer((prev) => prev || list[0].slug);
      })
      .catch(() => setServers([]));
  }, [basePath]);

  const graph: LogicGraph = useMemo(
    () => ({
      name: graphName.trim() || "my_logic",
      description: description.trim() || undefined,
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.data.kind,
        params: n.data.params,
        x: n.position.x,
        y: n.position.y,
      })),
      edges: edges.map((e) => ({ from: e.source, to: e.target })),
    }),
    [nodes, edges, graphName, description],
  );

  const errors = useMemo(() => validateGraph(graph), [graph]);
  const errorByNode = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const error of errors) {
      if (error.nodeId) {
        map[error.nodeId] = [...(map[error.nodeId] ?? []), error.message];
      }
    }
    return map;
  }, [errors]);

  // keep node error badges fresh
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) =>
        JSON.stringify(n.data.errors) !== JSON.stringify(errorByNode[n.id] ?? [])
          ? { ...n, data: { ...n.data, errors: errorByNode[n.id] ?? [] } }
          : n,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorByNode]);

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const addNode = useCallback(
    (kind: LogicNodeKind) => {
      const id = `n${Date.now().toString(36)}`;
      const role = kindRole(kind);
      setNodes((prev) => [
        ...prev,
        {
          id,
          type: "logic",
          position: {
            x: 120 + (role === "event" ? 0 : role === "condition" ? 280 : 560),
            y: 80 + (prev.length % 6) * 110,
          },
          data: {
            kind,
            params: kind === "act_message" ? { text: "", color: "gray" } : {},
            errors: [],
          },
        },
      ]);
    },
    [setNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge({ ...connection, animated: true }, eds),
      ),
    [setEdges],
  );

  const updateSelectedParam = (key: string, value: string) => {
    if (!selected) return;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === selected.id
          ? { ...n, data: { ...n.data, params: { ...n.data.params, [key]: value } } }
          : n,
      ),
    );
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes((prev) => prev.filter((n) => n.id !== selectedId));
    setEdges((prev) => prev.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  };

  const compiled = useMemo(() => compileLogicGraph(graph), [graph]);

  const handleSave = async () => {
    if (!basePath) return;
    if (errors.length > 0) {
      toast.warning("Fix the red nodes first", {
        description: errors[0].message,
      });
      return;
    }
    setBusy(true);
    try {
      await saveLogicGraph(basePath, graph);
      toast.success(`Graph "${graph.name}" saved`, {
        description: "logic/" + graph.name + ".json — reopen it from the workspace anytime.",
      });
    } catch (error) {
      toast.error("Could not save", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = async () => {
    if (!basePath || !targetServer) return;
    if (errors.length > 0) {
      toast.warning("Fix the red nodes first", { description: errors[0].message });
      return;
    }
    setBusy(true);
    try {
      const result = await installLogicGraph(basePath, graph, targetServer);
      toast.success(`Installed on ${targetServer}`, {
        description: `${result.filesWritten} files written — run /reload on the server and the logic is live.`,
        duration: 12000,
      });
    } catch (error) {
      toast.error("Install failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAi = async () => {
    if (!aiPrompt.trim() || busy) return;
    setBusy(true);
    try {
      const designed = await designLogicGraphWithAi(aiPrompt.trim());
      setGraphName(designed.name);
      setDescription(designed.description ?? "");
      setNodes(
        designed.nodes.map((node: LogicNode) => ({
          id: node.id,
          type: "logic",
          position: { x: node.x ?? 100, y: node.y ?? 100 },
          data: { kind: node.kind, params: node.params, errors: [] },
        })),
      );
      setEdges(
        designed.edges.map((edge: { from: string; to: string }) => ({
          id: `${edge.from}-${edge.to}`,
          source: edge.from,
          target: edge.to,
          animated: true,
        })),
      );
      toast.success("The AI built the graph — review, edit, install", {
        description: designed.description,
        duration: 10000,
      });
    } catch (error) {
      toast.error("The AI could not design this", {
        description: error instanceof Error ? error.message : String(error),
        duration: 12000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-56px)] min-h-0 gap-0">
      {/* palette */}
      <aside className="hidden w-52 shrink-0 space-y-3 overflow-y-auto border-r border-border/60 bg-card/40 p-3 lg:block">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("Nodes")}
        </p>
        {(["event", "condition", "action"] as const).map((role) => (
          <div key={role} className="space-y-1.5">
            {ALL_KINDS.filter((k) => kindRole(k) === role).map((k) => (
              <PaletteButton key={k} kind={k} onAdd={addNode} />
            ))}
          </div>
        ))}
      </aside>

      {/* canvas */}
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
        >
          <Background gap={18} />
          <Controls />
        </ReactFlow>

        {/* header strip */}
        <div className="absolute inset-x-3 top-3 flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/80 p-2 backdrop-blur">
          <Input
            value={graphName}
            onChange={(e) => setGraphName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
            className="h-8 w-44 font-mono text-xs"
            title={t("Graph name")}
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("What this logic does…")}
            className="h-8 w-56 text-xs"
          />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowPreview((v) => !v)}>
              <Zap className="h-3.5 w-3.5" />
              {showPreview ? t("Hide preview") : t("Preview the datapack")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void handleSave()} disabled={busy}>
              <Save className="h-3.5 w-3.5" />
              {t("Save")}
            </Button>
            {servers.length > 0 ? (
              <>
                <Select value={targetServer} onValueChange={setTargetServer}>
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue placeholder={t("Target server")} />
                  </SelectTrigger>
                  <SelectContent>
                    {servers.map((s) => (
                      <SelectItem key={s.slug} value={s.slug}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="gradient" onClick={() => void handleInstall()} disabled={busy}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {t("Install")}
                </Button>
              </>
            ) : (
              <Badge variant="outline">{t("Create a server to install")}</Badge>
            )}
          </div>
        </div>

        {/* validation strip */}
        {errors.length > 0 && (
          <div className="absolute inset-x-3 bottom-3 max-h-32 space-y-1 overflow-y-auto rounded-xl border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive backdrop-blur">
            {errors.slice(0, 6).map((error, i) => (
              <p key={i}>● {error.message}</p>
            ))}
            {errors.length > 6 && <p>+{errors.length - 6} more…</p>}
          </div>
        )}

        {/* AI designer strip */}
        <div className="absolute inset-x-3 bottom-3 flex gap-2 rounded-xl border border-primary/30 bg-card/85 p-2 backdrop-blur">
          <Input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleAi()}
            placeholder={t(
              'Ask the AI: "when a player mines diamond_ore with rank 2+, add 5 coins and announce it"',
            )}
            className="h-8 flex-1 text-xs"
          />
          <Button size="sm" variant="gradient" onClick={() => void handleAi()} disabled={busy || !aiPrompt.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {t("Build the graph")}
          </Button>
        </div>
      </div>

      {/* properties / preview */}
      <aside className="hidden w-80 shrink-0 space-y-3 overflow-y-auto border-l border-border/60 bg-card/40 p-3 xl:block">
        {showPreview ? (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("Preview — the real mcfunctions")}
            </p>
            {compiled.files.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t("Fix the errors to see the generated files.")}
              </p>
            ) : (
              compiled.files.map((file) => (
                <div key={file.path} className="rounded-lg border border-border/60 bg-background/70 p-2">
                  <p className="truncate font-mono text-[9px] text-primary">{file.path.split("datapacks/")[1]}</p>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[9px] leading-relaxed text-muted-foreground">
                    {file.content}
                  </pre>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {selected ? kindLabel(selected.data.kind) : t("Properties")}
            </p>
            {!selected ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("Click a node to configure it. Drag from the right dot to the left dot to connect. Events flow through conditions into actions — exactly what the compiler installs.")}
              </p>
            ) : (
              <>
                {requiredParams(selected.data.kind).map((key) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px]">{key}</Label>
                    <Input
                      className="h-8 text-xs"
                      value={String(selected.data.params[key] ?? "")}
                      onChange={(e) => updateSelectedParam(key, e.target.value)}
                    />
                  </div>
                ))}
                {(errorByNode[selected.id] ?? []).map((message, i) => (
                  <p key={i} className="text-[10px] text-destructive">● {message}</p>
                ))}
                <Button size="sm" variant="destructive" className="w-full" onClick={deleteSelected}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("Delete node")}
                </Button>
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

export function VisualLogicPage() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
