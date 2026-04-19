import type { ReportKind, TaskDetail } from "../lib/types";
import { StatusBadge } from "./StatusBadge";

function kindEquals(a: ReportKind, b: ReportKind): boolean {
  if (a === "summary" && b === "summary") return true;
  if (typeof a === "object" && typeof b === "object") return a.subTask === b.subTask;
  return false;
}

export function AgentSidebar({
  detail,
  selected,
  onSelect,
}: {
  detail: TaskDetail;
  selected: ReportKind;
  onSelect: (kind: ReportKind) => void;
}): JSX.Element {
  const summaryKind: ReportKind = "summary";
  return (
    <div className="h-full overflow-y-auto border-r border-neutral-800 bg-neutral-900">
      <button
        type="button"
        onClick={() => onSelect(summaryKind)}
        className={`w-full text-left px-3 py-2 border-b border-neutral-800 ${
          kindEquals(selected, summaryKind) ? "bg-neutral-800" : "hover:bg-neutral-900/80"
        }`}
      >
        <div className="text-sm font-medium">Summary</div>
        <div className="text-xs text-neutral-500 mt-0.5">
          <StatusBadge status={detail.effectiveStatus} />
        </div>
      </button>
      {detail.subTasks.map((s) => {
        const kind: ReportKind = { subTask: s.id };
        const active = kindEquals(selected, kind);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(kind)}
            className={`w-full text-left px-3 py-2 border-b border-neutral-800 ${
              active ? "bg-neutral-800" : "hover:bg-neutral-900/80"
            }`}
          >
            <div className="text-sm truncate">{s.assignedAgent}</div>
            <div className="text-xs text-neutral-500 truncate">{s.title}</div>
            <div className="mt-0.5"><StatusBadge status={s.status} /></div>
          </button>
        );
      })}
    </div>
  );
}
