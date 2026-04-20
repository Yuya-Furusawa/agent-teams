import { useCallback, useEffect, useMemo, useState } from "react";
import { TaskList } from "./components/TaskList";
import { AgentSidebar } from "./components/AgentSidebar";
import { ReportView } from "./components/ReportView";
import { WorkflowGraph } from "./components/WorkflowGraph";
import { ReportDrawer } from "./components/ReportDrawer";
import { EmptyState } from "./components/EmptyState";
import { CalendarPicker } from "./components/CalendarPicker";
import {
  getReport,
  getWorkflow,
  listAgents,
  listTasks,
  onTasksChanged,
} from "./lib/ipc";
import { toLocalDateKey } from "./lib/time";
import type { ReportKind, Task, WorkflowGraph as WorkflowGraphData } from "./lib/types";

type ViewMode = "list" | "graph";

export function App(): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowGraphData | null>(null);
  const [selectedKind, setSelectedKind] = useState<ReportKind>("summary");
  const [report, setReport] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() =>
    toLocalDateKey(Date.now()),
  );
  const [userPickedDate, setUserPickedDate] = useState(false);
  const [agentRoles, setAgentRoles] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const detail = workflow?.detail ?? null;

  const bump = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    listTasks()
      .then(setTasks)
      .catch((e) => setError(String(e)));
  }, [generation]);

  useEffect(() => {
    listAgents()
      .then((agents) => {
        const map: Record<string, string> = {};
        for (const a of agents) {
          if (a.role) map[a.name] = a.role;
        }
        setAgentRoles(map);
      })
      .catch(() => {
        // non-fatal: sidebar falls back to name-only
      });
  }, []);

  useEffect(() => {
    if (!selectedTaskId) {
      setWorkflow(null);
      setDrawerOpen(false);
      return;
    }
    getWorkflow(selectedTaskId)
      .then((w) => {
        setWorkflow(w);
        setSelectedKind((prev) => (prev === "plannerEvents" ? prev : "summary"));
      })
      .catch((e) => setError(String(e)));
  }, [selectedTaskId, generation]);

  useEffect(() => {
    if (!selectedTaskId) {
      setReport(null);
      return;
    }
    setReportLoading(true);
    getReport(selectedTaskId, selectedKind)
      .then(setReport)
      .catch((e) => setError(String(e)))
      .finally(() => setReportLoading(false));
  }, [selectedTaskId, selectedKind, generation]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    onTasksChanged((payload) => {
      if (payload.taskId == null || payload.taskId === selectedTaskId) {
        bump();
      } else {
        listTasks().then(setTasks).catch(() => {});
      }
    }).then((u) => {
      if (cancelled) { u(); return; }
      unlisten = u;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [selectedTaskId, bump]);

  const missingLabel = useMemo(() => {
    if (selectedKind === "summary") return "Summary not available yet.";
    if (selectedKind === "plannerEvents") return "Planner events not recorded.";
    return "Report not written yet.";
  }, [selectedKind]);

  const activeDateKeys = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) s.add(toLocalDateKey(t.createdAt));
    return s;
  }, [tasks]);

  const tasksForSelectedDay = useMemo(
    () => tasks.filter((t) => toLocalDateKey(t.createdAt) === selectedDateKey),
    [tasks, selectedDateKey],
  );

  useEffect(() => {
    if (userPickedDate || tasks.length === 0) return;
    const newest = tasks.reduce((acc, t) => (t.createdAt > acc ? t.createdAt : acc), 0);
    if (newest > 0) setSelectedDateKey(toLocalDateKey(newest));
  }, [tasks, userPickedDate]);

  const handleDatePick = useCallback((dateKey: string) => {
    setUserPickedDate(true);
    setSelectedDateKey(dateKey);
  }, []);

  const handleGraphSelect = useCallback((kind: ReportKind) => {
    setSelectedKind(kind);
    setDrawerOpen(true);
  }, []);

  return (
    <div className="h-full w-full grid grid-cols-[260px_1fr] bg-neutral-950 text-neutral-100 overflow-hidden">
      <aside className="border-r border-neutral-800 flex flex-col min-h-0 overflow-hidden">
        <header className="px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-800 flex items-center justify-between">
          <span>Tasks</span>
          <button
            onClick={bump}
            className="text-neutral-400 hover:text-neutral-200"
            title="Refresh"
          >↻</button>
        </header>
        <CalendarPicker
          selectedDateKey={selectedDateKey}
          onSelect={handleDatePick}
          activeDateKeys={activeDateKeys}
        />
        <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-neutral-500 border-b border-neutral-800 flex items-center justify-between">
          <span>{selectedDateKey}</span>
          <span>{tasksForSelectedDay.length}件</span>
        </div>
        <div className="flex-1 min-h-0">
          <TaskList
            tasks={tasksForSelectedDay}
            selectedId={selectedTaskId}
            onSelect={setSelectedTaskId}
            emptyHint={
              tasks.length === 0 ? undefined : <>この日のタスクはありません。</>
            }
          />
        </div>
      </aside>
      <div className="flex flex-col min-h-0 min-w-0">
        <header className="border-b border-neutral-800 flex items-center gap-1 px-3 py-1.5 text-xs shrink-0">
          <ViewTab label="List" active={viewMode === "list"} onClick={() => setViewMode("list")} />
          <ViewTab label="Graph" active={viewMode === "graph"} onClick={() => setViewMode("graph")} />
          <div className="flex-1" />
          {error && (
            <span className="text-bad text-[11px] truncate max-w-[50%]" title={error}>
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-2 hover:text-neutral-100"
              >✕</button>
            </span>
          )}
        </header>
        <div className="flex-1 min-h-0 min-w-0 flex">
          {viewMode === "list" ? (
            <>
              <aside className="w-[220px] shrink-0 min-h-0 overflow-hidden border-r border-neutral-800">
                {detail ? (
                  <AgentSidebar
                    detail={detail}
                    selected={selectedKind}
                    onSelect={setSelectedKind}
                    agentRoles={agentRoles}
                  />
                ) : (
                  <EmptyState title="Select a task" />
                )}
              </aside>
              <main className="flex-1 min-w-0 min-h-0">
                {selectedTaskId ? (
                  <ReportView body={report} loading={reportLoading} missingLabel={missingLabel} />
                ) : (
                  <EmptyState title="No task selected" hint="Pick a task from the left to view its summary and per-agent reports." />
                )}
              </main>
            </>
          ) : (
            <>
              <main className="flex-1 min-w-0 min-h-0">
                {workflow ? (
                  <WorkflowGraph
                    graph={workflow}
                    selected={drawerOpen ? selectedKind : null}
                    onSelect={handleGraphSelect}
                    agentRoles={agentRoles}
                  />
                ) : (
                  <EmptyState
                    title={selectedTaskId ? "Loading…" : "No task selected"}
                    hint={
                      selectedTaskId
                        ? undefined
                        : "Pick a task from the left to view its workflow."
                    }
                  />
                )}
              </main>
              {drawerOpen && (
                <div className="w-[420px] shrink-0 min-h-0">
                  <ReportDrawer
                    kind={selectedKind}
                    body={report}
                    loading={reportLoading}
                    subTasks={detail?.subTasks ?? []}
                    onClose={() => setDrawerOpen(false)}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ViewTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-xs uppercase tracking-wide ${
        active ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-200"
      }`}
    >
      {label}
    </button>
  );
}
