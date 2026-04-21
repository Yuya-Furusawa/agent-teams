import type {
  ReportKind,
  StageStatus,
  SubTask,
  WorkflowGraph,
  WorkflowStage,
} from "./types";

const TERMINAL_SUB_STATUSES: ReadonlyArray<SubTask["status"]> = ["completed", "failed"];

function allTerminal(subs: SubTask[]): boolean {
  return subs.length > 0 && subs.every((s) => TERMINAL_SUB_STATUSES.includes(s.status));
}

function planningStatus(graph: WorkflowGraph): StageStatus {
  const { detail } = graph;
  if (detail.subTasks.length > 0) return "completed";
  if (detail.task.status === "planning") return "running";
  if (detail.task.status === "failed") return "failed";
  return "pending";
}

function summaryStatus(graph: WorkflowGraph): StageStatus {
  const { detail, artifacts } = graph;
  if (artifacts.summaryExists || detail.task.status === "completed") return "completed";
  if (detail.task.status === "failed") return "failed";
  if (detail.task.status === "running" && allTerminal(detail.subTasks)) return "running";
  return "pending";
}

export function deriveWorkflow(
  graph: WorkflowGraph,
  agentRoles?: Record<string, string>,
): WorkflowStage[] {
  const stages: WorkflowStage[] = [];

  stages.push({
    kind: "planning",
    label: "Planning",
    status: planningStatus(graph),
    subTaskId: null,
    agent: "Sage",
    role: agentRoles?.["Sage"] ?? "planner",
  });

  for (const s of graph.detail.subTasks) {
    stages.push({
      kind: "workers",
      label: s.title || s.assignedAgent,
      status: s.status,
      subTaskId: s.id,
      agent: s.assignedAgent,
      role: agentRoles?.[s.assignedAgent],
      targetRepo: s.targetRepo,
      dependsOn: s.dependsOn,
      round: s.round,
    });
  }

  stages.push({
    kind: "summary",
    label: "Summary",
    status: summaryStatus(graph),
    subTaskId: null,
    agent: "Sage",
    role: agentRoles?.["Sage"] ?? "summarizer",
  });

  return stages;
}

export function stageToReportKind(stage: WorkflowStage): ReportKind | null {
  if (stage.kind === "summary") return "summary";
  if (stage.kind === "planning") return "plannerEvents";
  if (stage.subTaskId) return { subTask: stage.subTaskId };
  return null;
}

export interface LayoutNode {
  id: string;
  stage: WorkflowStage;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  fromId: string;
  toId: string;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
  paddingX?: number;
  paddingY?: number;
}

const DEFAULT_LAYOUT: Required<LayoutOptions> = {
  nodeWidth: 180,
  nodeHeight: 72,
  horizontalGap: 24,
  verticalGap: 56,
  paddingX: 24,
  paddingY: 24,
};

function workerNodeId(subTaskId: string): string {
  return `worker-${subTaskId}`;
}

/**
 * Bucket workers into layers via longest-path-from-source. A worker's layer is
 * `max(layer of each dep) + 1`. Workers with no deps land in layer 0. Deps that
 * reference unknown ids (shouldn't happen with validated plans) are treated as
 * layer -1 so the referencing worker still places at layer 0.
 */
function layerWorkers(workers: WorkflowStage[]): WorkflowStage[][] {
  const byId = new Map<string, WorkflowStage>();
  for (const w of workers) if (w.subTaskId) byId.set(w.subTaskId, w);

  const memo = new Map<string, number>();
  const resolving = new Set<string>();
  function layer(id: string): number {
    if (memo.has(id)) return memo.get(id)!;
    if (resolving.has(id)) return 0; // cycle guard; shouldn't happen with validated plans
    const w = byId.get(id);
    if (!w) return -1;
    resolving.add(id);
    const deps = (w.dependsOn ?? []).filter((d) => byId.has(d));
    const lvl = deps.length === 0 ? 0 : Math.max(...deps.map((d) => layer(d))) + 1;
    resolving.delete(id);
    memo.set(id, lvl);
    return lvl;
  }

  const layers: WorkflowStage[][] = [];
  for (const w of workers) {
    const lvl = w.subTaskId ? layer(w.subTaskId) : 0;
    const bucket = Math.max(0, lvl);
    while (layers.length <= bucket) layers.push([]);
    layers[bucket]!.push(w);
  }
  return layers;
}

export function layoutWorkflow(
  stages: WorkflowStage[],
  options: LayoutOptions = {},
): LayoutResult {
  const cfg = { ...DEFAULT_LAYOUT, ...options };
  const planning = stages.find((s) => s.kind === "planning");
  const summary = stages.find((s) => s.kind === "summary");
  const workers = stages.filter((s) => s.kind === "workers");

  const layers = layerWorkers(workers);
  const widestLayer = Math.max(1, ...layers.map((l) => l.length));
  const canvasContentWidth =
    widestLayer * cfg.nodeWidth + (widestLayer - 1) * cfg.horizontalGap;
  const canvasWidth = cfg.paddingX * 2 + Math.max(canvasContentWidth, cfg.nodeWidth);
  const centerX = canvasWidth / 2;

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  const rowY = (row: number): number =>
    cfg.paddingY + row * (cfg.nodeHeight + cfg.verticalGap);

  // Row 0: Planning.
  if (planning) {
    nodes.push({
      id: "planning",
      stage: planning,
      x: centerX - cfg.nodeWidth / 2,
      y: rowY(0),
      width: cfg.nodeWidth,
      height: cfg.nodeHeight,
    });
  }

  // Rows 1..layers.length: each worker layer, centered horizontally.
  const workerIds = new Set<string>();
  layers.forEach((layerStages, layerIdx) => {
    const row = 1 + layerIdx;
    const rowWidth =
      layerStages.length * cfg.nodeWidth +
      (layerStages.length - 1) * cfg.horizontalGap;
    const baseX = centerX - rowWidth / 2;
    layerStages.forEach((w, col) => {
      if (!w.subTaskId) return;
      const id = workerNodeId(w.subTaskId);
      workerIds.add(w.subTaskId);
      nodes.push({
        id,
        stage: w,
        x: baseX + col * (cfg.nodeWidth + cfg.horizontalGap),
        y: rowY(row),
        width: cfg.nodeWidth,
        height: cfg.nodeHeight,
      });
      const deps = (w.dependsOn ?? []).filter((d) => workerIds.has(d));
      if (deps.length === 0) {
        if (planning) edges.push({ fromId: "planning", toId: id });
      } else {
        for (const d of deps) edges.push({ fromId: workerNodeId(d), toId: id });
      }
    });
  });

  // Last row: Summary. Only sink workers (no dependents) feed it.
  const summaryRow = 1 + Math.max(layers.length, 1);
  if (summary) {
    nodes.push({
      id: "summary",
      stage: summary,
      x: centerX - cfg.nodeWidth / 2,
      y: rowY(summaryRow),
      width: cfg.nodeWidth,
      height: cfg.nodeHeight,
    });
    const dependedUpon = new Set<string>();
    for (const w of workers) {
      for (const d of w.dependsOn ?? []) dependedUpon.add(d);
    }
    const sinks = workers.filter(
      (w) => w.subTaskId && !dependedUpon.has(w.subTaskId),
    );
    if (sinks.length === 0 && planning) {
      edges.push({ fromId: "planning", toId: "summary" });
    } else {
      for (const w of sinks) {
        edges.push({ fromId: workerNodeId(w.subTaskId!), toId: "summary" });
      }
    }
  }

  const height = rowY(summaryRow) + cfg.nodeHeight + cfg.paddingY;
  return { nodes, edges, width: canvasWidth, height };
}

export interface WorkflowProgress {
  total: number;
  completed: number;
  running: number;
  failed: number;
}

export function workflowProgress(stages: WorkflowStage[]): WorkflowProgress {
  const workers = stages.filter((s) => s.kind === "workers");
  return {
    total: workers.length,
    completed: workers.filter((s) => s.status === "completed").length,
    running: workers.filter((s) => s.status === "running").length,
    failed: workers.filter((s) => s.status === "failed").length,
  };
}
