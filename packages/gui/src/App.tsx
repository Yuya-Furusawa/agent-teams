import { useCallback, useEffect, useMemo, useState } from "react";
import { TaskList } from "./components/TaskList";
import { AgentSidebar } from "./components/AgentSidebar";
import { ReportView } from "./components/ReportView";
import { EmptyState } from "./components/EmptyState";
import { CalendarPicker } from "./components/CalendarPicker";
import {
  getReport,
  getTaskDetail,
  listAgents,
  listTasks,
  onTasksChanged,
} from "./lib/ipc";
import { toLocalDateKey } from "./lib/time";
import type { ReportKind, Task, TaskDetail } from "./lib/types";

export function App(): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
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

  const bump = useCallback(() => setGeneration((g) => g + 1), []);

  // list_tasks on mount + when generation changes
  useEffect(() => {
    listTasks()
      .then(setTasks)
      .catch((e) => setError(String(e)));
  }, [generation]);

  // list_agents once on mount — role metadata rarely changes within a session
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

  // get_task_detail when selection changes
  useEffect(() => {
    if (!selectedTaskId) {
      setDetail(null);
      return;
    }
    getTaskDetail(selectedTaskId)
      .then((d) => {
        setDetail(d);
        setSelectedKind("summary");
      })
      .catch((e) => setError(String(e)));
  }, [selectedTaskId, generation]);

  // get_report when selected doc changes
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

  // live updates
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    onTasksChanged((payload) => {
      if (payload.taskId == null || payload.taskId === selectedTaskId) {
        bump();
      } else {
        // silently refresh the list but don't touch the current detail fetch
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

  // If the user hasn't picked a day yet, follow the latest task.
  useEffect(() => {
    if (userPickedDate || tasks.length === 0) return;
    const newest = tasks.reduce((acc, t) => (t.createdAt > acc ? t.createdAt : acc), 0);
    if (newest > 0) setSelectedDateKey(toLocalDateKey(newest));
  }, [tasks, userPickedDate]);

  const handleDatePick = useCallback((dateKey: string) => {
    setUserPickedDate(true);
    setSelectedDateKey(dateKey);
  }, []);

  return (
    <div className="h-full w-full grid grid-cols-[260px_220px_1fr] bg-neutral-950 text-neutral-100 overflow-hidden">
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
      <aside className="min-h-0 overflow-hidden">
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
      <main className="min-w-0 min-h-0 overflow-hidden flex flex-col">
        {error && (
          <div className="bg-bad/20 text-bad text-xs px-3 py-2 border-b border-bad/40 flex items-center gap-3 shrink-0">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="hover:text-neutral-100">✕</button>
          </div>
        )}
        <div className="flex-1 min-h-0">
          {selectedTaskId ? (
            <ReportView body={report} loading={reportLoading} missingLabel={missingLabel} />
          ) : (
            <EmptyState title="No task selected" hint="Pick a task from the left to view its summary and per-agent reports." />
          )}
        </div>
      </main>
    </div>
  );
}
