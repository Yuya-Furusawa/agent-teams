import type { WorkflowStage } from "../lib/types";
import { StatusBadge } from "./StatusBadge";

const KIND_GLYPH: Record<WorkflowStage["kind"], string> = {
  planning: "◇",
  workers: "▣",
  summary: "◎",
};

function ringClass(status: WorkflowStage["status"]): string {
  switch (status) {
    case "running":
      return "ring-2 ring-warn/70 animate-pulse";
    case "failed":
      return "ring-2 ring-bad/80";
    case "completed":
      return "ring-1 ring-ok/40";
    case "pending":
    default:
      return "ring-1 ring-neutral-700 opacity-60";
  }
}

export function WorkflowNode({
  stage,
  active,
  onClick,
}: {
  stage: WorkflowStage;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full h-full rounded-md bg-neutral-900 border border-neutral-800 text-left px-3 py-2 flex flex-col justify-between transition-colors ${ringClass(
        stage.status,
      )} ${active ? "bg-neutral-800 border-neutral-600" : "hover:bg-neutral-800/60"}`}
    >
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-neutral-500 text-[10px]">{KIND_GLYPH[stage.kind]}</span>
        <span className="text-sm font-medium truncate">{stage.agent}</span>
        {stage.role && (
          <span className="text-[10px] uppercase tracking-wide text-neutral-500 truncate">
            {stage.role}
          </span>
        )}
      </div>
      <div className="text-xs text-neutral-400 truncate">{stage.label}</div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <StatusBadge status={stage.status} />
        {stage.targetRepo && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-neutral-700 text-neutral-200 truncate max-w-[50%]">
            {stage.targetRepo}
          </span>
        )}
      </div>
    </button>
  );
}
