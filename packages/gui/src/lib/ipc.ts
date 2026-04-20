import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentInfo,
  ReportKind,
  Task,
  TaskDetail,
  TasksChangedPayload,
  WorkflowGraph,
} from "./types";

export async function listTasks(limit = 100, offset = 0): Promise<Task[]> {
  return invoke<Task[]>("list_tasks", { limit, offset });
}

export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  return invoke<TaskDetail | null>("get_task_detail", { taskId });
}

export async function getWorkflow(taskId: string): Promise<WorkflowGraph | null> {
  return invoke<WorkflowGraph | null>("get_workflow", { taskId });
}

export async function getReport(
  taskId: string,
  kind: ReportKind,
): Promise<string | null> {
  return invoke<string | null>("get_report", { taskId, kind });
}

export async function listAgents(): Promise<AgentInfo[]> {
  return invoke<AgentInfo[]>("list_agents");
}

export async function listWorkspaces(): Promise<string[]> {
  return invoke<string[]>("list_workspaces");
}

export async function onTasksChanged(
  handler: (payload: TasksChangedPayload) => void,
): Promise<UnlistenFn> {
  return listen<TasksChangedPayload>("tasks-changed", (e) => handler(e.payload));
}
