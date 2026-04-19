import { useCallback, useEffect, useMemo, useState } from "react";
import { TaskList } from "./components/TaskList";
import { AgentSidebar } from "./components/AgentSidebar";
import { ReportView } from "./components/ReportView";
import { EmptyState } from "./components/EmptyState";
import {
  getReport,
  getTaskDetail,
  listTasks,
  onTasksChanged,
} from "./lib/ipc";
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

  const bump = useCallback(() => setGeneration((g) => g + 1), []);

  // list_tasks on mount + when generation changes
  useEffect(() => {
    listTasks()
      .then(setTasks)
      .catch((e) => setError(String(e)));
  }, [generation]);

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

  return (
    <div className="h-full w-full grid grid-cols-[260px_220px_1fr] bg-neutral-950 text-neutral-100">
      <aside className="border-r border-neutral-800">
        <header className="px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-800 flex items-center justify-between">
          <span>Tasks</span>
          <button
            onClick={bump}
            className="text-neutral-400 hover:text-neutral-200"
            title="Refresh"
          >↻</button>
        </header>
        <TaskList tasks={tasks} selectedId={selectedTaskId} onSelect={setSelectedTaskId} />
      </aside>
      <aside>
        {detail ? (
          <AgentSidebar detail={detail} selected={selectedKind} onSelect={setSelectedKind} />
        ) : (
          <EmptyState title="Select a task" />
        )}
      </aside>
      <main className="min-w-0">
        {error && (
          <div className="bg-bad/20 text-bad text-xs px-3 py-2 border-b border-bad/40 flex items-center gap-3">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="hover:text-neutral-100">✕</button>
          </div>
        )}
        {selectedTaskId ? (
          <ReportView body={report} loading={reportLoading} missingLabel={missingLabel} />
        ) : (
          <EmptyState title="No task selected" hint="Pick a task from the left to view its summary and per-agent reports." />
        )}
      </main>
    </div>
  );
}
