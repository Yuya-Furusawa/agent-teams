import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReportKind, WorkflowGraph as WorkflowGraphData } from "../lib/types";
import {
  deriveWorkflow,
  layoutWorkflow,
  stageToReportKind,
  workflowProgress,
  type LayoutEdge,
  type LayoutNode,
} from "../lib/workflow";
import { WorkflowNode } from "./WorkflowNode";

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.01;

function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

function edgePath(from: LayoutNode, to: LayoutNode): string {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  const midY = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

function edgeColor(status: string): string {
  if (status === "running") return "#fbbf24";
  if (status === "failed") return "#ef4444";
  if (status === "completed") return "#4ade80";
  return "#525252";
}

export function WorkflowGraph({
  graph,
  selected,
  onSelect,
  agentRoles,
}: {
  graph: WorkflowGraphData;
  selected: ReportKind | null;
  onSelect: (kind: ReportKind) => void;
  agentRoles?: Record<string, string>;
}): JSX.Element {
  const stages = useMemo(() => deriveWorkflow(graph, agentRoles), [graph, agentRoles]);
  const layout = useMemo(() => layoutWorkflow(stages), [stages]);
  const progress = useMemo(() => workflowProgress(stages), [stages]);

  const nodeById = useMemo(() => {
    const m = new Map<string, LayoutNode>();
    for (const n of layout.nodes) m.set(n.id, n);
    return m;
  }, [layout.nodes]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  zoomRef.current = zoom;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const prev = zoomRef.current;
      const next = clampZoom(prev * Math.exp(-e.deltaY * ZOOM_STEP));
      if (next === prev) return;
      const ratio = next / prev;
      pendingScrollRef.current = {
        x: (mx + el.scrollLeft) * ratio - mx,
        y: (my + el.scrollTop) * ratio - my,
      };
      setZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    const el = scrollRef.current;
    if (!pending || !el) return;
    el.scrollLeft = Math.max(0, pending.x);
    el.scrollTop = Math.max(0, pending.y);
    pendingScrollRef.current = null;
  }, [zoom]);

  const resetZoom = () => {
    pendingScrollRef.current = { x: 0, y: 0 };
    setZoom(1);
  };

  const isActive = (kind: ReportKind | null): boolean => {
    if (!kind || !selected) return false;
    if (kind === "summary" && selected === "summary") return true;
    if (kind === "plannerEvents" && selected === "plannerEvents") return true;
    if (
      typeof kind === "object" &&
      typeof selected === "object" &&
      kind.subTask === selected.subTask
    ) {
      return true;
    }
    return false;
  };

  return (
    <div className="h-full flex flex-col bg-neutral-950 text-neutral-100 min-h-0">
      <header className="bg-neutral-950/95 backdrop-blur px-4 py-2 border-b border-neutral-800 flex items-center gap-3 text-xs text-neutral-400 shrink-0">
        <span className="uppercase tracking-wide">Workflow</span>
        <span>
          Workers {progress.completed}/{progress.total}
        </span>
        {progress.running > 0 && (
          <span className="text-warn">· {progress.running} running</span>
        )}
        {progress.failed > 0 && (
          <span className="text-bad">· {progress.failed} failed</span>
        )}
        <div className="flex-1" />
        <span className="text-neutral-500 tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={resetZoom}
          className="text-neutral-400 hover:text-neutral-100 px-1.5 py-0.5 rounded hover:bg-neutral-800"
          title="Reset zoom"
        >
          Reset
        </button>
      </header>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto p-4"
      >
        <div
          style={{
            width: layout.width * zoom,
            height: layout.height * zoom,
          }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "0 0",
            }}
            role="img"
            aria-label="Workflow graph"
          >
            <g>
              {layout.edges.map((e: LayoutEdge) => {
                const from = nodeById.get(e.fromId);
                const to = nodeById.get(e.toId);
                if (!from || !to) return null;
                return (
                  <path
                    key={`${e.fromId}->${e.toId}`}
                    d={edgePath(from, to)}
                    stroke={edgeColor(to.stage.status)}
                    strokeWidth={1.5}
                    fill="none"
                    opacity={to.stage.status === "pending" ? 0.4 : 0.8}
                  />
                );
              })}
            </g>
            <g>
              {layout.nodes.map((n) => {
                const kind = stageToReportKind(n.stage);
                return (
                  <foreignObject
                    key={n.id}
                    x={n.x}
                    y={n.y}
                    width={n.width}
                    height={n.height}
                  >
                    <WorkflowNode
                      stage={n.stage}
                      active={isActive(kind)}
                      onClick={() => {
                        if (kind) onSelect(kind);
                      }}
                    />
                  </foreignObject>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
