import type { ReportKind, SubTask } from "../lib/types";
import { ReportView } from "./ReportView";
import { PlanningView } from "./PlanningView";

function drawerTitle(kind: ReportKind, subTasks: SubTask[]): string {
  if (kind === "summary") return "Summary";
  if (kind === "plannerEvents") return "Planning";
  const sub = subTasks.find((s) => s.id === kind.subTask);
  return sub ? `${sub.assignedAgent} — ${sub.title}` : "Report";
}

export function ReportDrawer({
  kind,
  body,
  loading,
  subTasks,
  onClose,
}: {
  kind: ReportKind;
  body: string | null;
  loading: boolean;
  subTasks: SubTask[];
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="h-full w-full flex flex-col bg-neutral-950 border-l border-neutral-800 min-w-0">
      <header className="px-4 py-2 border-b border-neutral-800 flex items-center gap-2 shrink-0">
        <span className="text-xs uppercase tracking-wide text-neutral-500">Report</span>
        <span className="text-sm text-neutral-200 truncate flex-1">
          {drawerTitle(kind, subTasks)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-100 text-sm px-1"
          title="Close"
        >
          ✕
        </button>
      </header>
      <div className="flex-1 min-h-0">
        {kind === "plannerEvents" ? (
          <PlanningView subTasks={subTasks} events={loading ? null : body} />
        ) : (
          <ReportView
            body={body}
            loading={loading}
            missingLabel={
              kind === "summary" ? "Summary not available yet." : "Report not written yet."
            }
          />
        )}
      </div>
    </div>
  );
}
