import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ReportKind,
  Task,
  TaskDetail,
  TasksChangedPayload,
} from "./types";

export async function listTasks(limit = 100, offset = 0): Promise<Task[]> {
  return invoke<Task[]>("list_tasks", { limit, offset });
}

export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  return invoke<TaskDetail | null>("get_task_detail", { taskId });
}

export async function getReport(
  taskId: string,
  kind: ReportKind,
): Promise<string | null> {
  return invoke<string | null>("get_report", { taskId, kind });
}

export async function onTasksChanged(
  handler: (payload: TasksChangedPayload) => void,
): Promise<UnlistenFn> {
  return listen<TasksChangedPayload>("tasks-changed", (e) => handler(e.payload));
}
