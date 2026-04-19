export type TaskStatus = "planning" | "running" | "completed" | "failed";
export type EffectiveTaskStatus = TaskStatus | "partial";
export type SubTaskStatus = "pending" | "running" | "completed" | "failed";

export interface Task {
  id: string;
  description: string;
  teamName: string;
  status: TaskStatus;
  createdAt: number;
  completedAt: number | null;
  subTaskCount: number;
  completedSubTaskCount: number;
  failedSubTaskCount: number;
  workspace: string | null;
}

export interface SubTask {
  id: string;
  taskId: string;
  title: string;
  assignedAgent: string;
  status: SubTaskStatus;
  createdAt: number;
  completedAt: number | null;
  targetRepo: string | null;
}

export interface TaskDetail {
  task: Task;
  subTasks: SubTask[];
  effectiveStatus: EffectiveTaskStatus;
}

export type ReportKind = "summary" | { subTask: string };

export interface TasksChangedPayload {
  taskId: string | null;
}
