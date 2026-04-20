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
  dependsOn: string[];
}

export interface TaskDetail {
  task: Task;
  subTasks: SubTask[];
  effectiveStatus: EffectiveTaskStatus;
}

export type ReportKind = "summary" | "plannerEvents" | { subTask: string };

export type StageKind = "planning" | "workers" | "summary";
export type StageStatus = "pending" | "running" | "completed" | "failed";

export interface WorkflowStage {
  kind: StageKind;
  label: string;
  status: StageStatus;
  /** Sub-task id when kind === "workers"; null for planning/summary. */
  subTaskId: string | null;
  /** Agent name for workers ("Sage" for planning/summary). */
  agent: string;
  role?: string | null;
  targetRepo?: string | null;
  /** Sub-task ids this worker depends on (empty for layer 0 / planning / summary). */
  dependsOn?: string[];
}

export interface TaskArtifacts {
  summaryExists: boolean;
  plannerEventsExists: boolean;
  triageEventsExists: boolean;
}

export interface WorkflowGraph {
  detail: TaskDetail;
  artifacts: TaskArtifacts;
}

export interface AgentInfo {
  name: string;
  role: string | null;
}

export interface TasksChangedPayload {
  taskId: string | null;
}
