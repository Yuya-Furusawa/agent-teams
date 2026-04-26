import { existsSync } from "node:fs";
import { hostname } from "node:os";
import {
  Storage,
  summaryFile,
  type ResumeLock,
  type SubTaskRow,
  type TaskRow,
} from "@agent-teams/storage";
import { loadAgentRegistry } from "./agent-registry.js";
import { resolveTeam, resolveWorkspaceTeam } from "./instance.js";
import { loadTeam } from "./team.js";

export type ResumeStage = "triage" | "workers" | "refix-planning" | "summarizer" | "noop";

/**
 * Decide which phase to re-enter for a paused / failed task. `summaryExists`
 * means `summary.md` is present on disk for the task. `roleOf` returns the
 * role for an agent name (or undefined if unknown — treated as non-reviewer).
 */
export function determineResumeStage(
  subTasks: SubTaskRow[],
  summaryExists: boolean,
  roleOf: (agent: string) => string | undefined,
): ResumeStage {
  if (subTasks.length === 0) return "triage";

  const hasIncomplete = subTasks.some((s) => s.status !== "completed");
  if (hasIncomplete) return "workers";

  const round1 = subTasks.filter((s) => s.round === 1);
  const round2 = subTasks.filter((s) => s.round === 2);
  const round1HadReviewers = round1.some((s) => (roleOf(s.assigned_agent) ?? "").endsWith("-reviewer"));

  if (round2.length === 0 && round1HadReviewers) return "refix-planning";
  if (!summaryExists) return "summarizer";
  return "noop";
}

export interface ResumeTaskOptions {
  taskId?: string;
  fromStage?: ResumeStage;
  force?: boolean;
}

export interface ResumeTaskResult {
  taskId: string;
  stage: ResumeStage;
  summaryPath: string;
  status: "completed" | "failed";
  multipleCandidates?: number;
}

const STALE_LOCK_MS = 30 * 60 * 1000;

export async function resumeTask(opts: ResumeTaskOptions = {}): Promise<ResumeTaskResult> {
  const storage = new Storage();
  try {
    const target = resolveTargetTaskId(storage, opts.taskId);
    const taskRow = requireResumableTask(storage, target.taskId);

    const lock: ResumeLock = { pid: process.pid, host: hostname(), started_at: Date.now() };
    if (!storage.acquireResumeLock(target.taskId, lock, STALE_LOCK_MS, opts.force ? { force: true } : undefined)) {
      const held = storage.readResumeLock(target.taskId);
      throw new Error(
        `task ${target.taskId} is locked by another process (pid=${held?.pid}, host=${held?.host}, ` +
        `started_at=${held?.started_at}). Wait or pass --force.`,
      );
    }
    try {
      const subTasks = storage.listSubTasks(target.taskId);
      const summaryPath = summaryFile(target.taskId);
      const summaryExists = existsSync(summaryPath);

      const stage = opts.fromStage ?? detectStage(taskRow, subTasks, summaryExists);
      const result = await dispatchStage({ stage, taskRow, subTasks, storage });

      storage.updateTaskStatus(target.taskId, result.status, Date.now());
      const out: ResumeTaskResult = {
        taskId: target.taskId, stage, summaryPath, status: result.status,
      };
      if (target.candidateCount > 1) out.multipleCandidates = target.candidateCount;
      return out;
    } finally {
      storage.releaseResumeLock(target.taskId, process.pid);
    }
  } finally {
    storage.close();
  }
}

interface ResolvedTarget {
  taskId: string;
  candidateCount: number;
}

function resolveTargetTaskId(storage: Storage, explicit: string | undefined): ResolvedTarget {
  if (explicit) return { taskId: explicit, candidateCount: 1 };
  const id = storage.findResumableTaskId();
  if (!id) throw new Error("no resumable task found");
  const total = storage.countResumableTasks();
  return { taskId: id, candidateCount: total };
}

function requireResumableTask(storage: Storage, taskId: string): TaskRow {
  const t = storage.getTask(taskId);
  if (!t) throw new Error(`task ${taskId} not found`);
  if (t.status === "completed") {
    throw new Error(`task ${taskId} already completed; use /team for a new run`);
  }
  if (t.status === "awaiting_user_input" || t.pbi_state) {
    throw new Error(`task ${taskId} is a PBI flow; use 'agent-teams pbi-resume' instead`);
  }
  if (t.status === "planning") {
    throw new Error(`task ${taskId} is currently in planning state; wait for it to settle`);
  }
  return t;
}

function detectStage(
  task: TaskRow,
  subTasks: SubTaskRow[],
  summaryExists: boolean,
): ResumeStage {
  const registry = loadAgentRegistry();
  const team = task.workspace_name
    ? resolveWorkspaceTeam(task.workspace_name, registry)
    : loadTeam(`${task.cwd}/agent-team.yaml`);
  const workerInstances = resolveTeam(team, registry);
  const byName = new Map(workerInstances.map((i) => [i.name, i.role]));
  return determineResumeStage(subTasks, summaryExists, (n) => byName.get(n));
}

interface DispatchArgs {
  stage: ResumeStage;
  taskRow: TaskRow;
  subTasks: SubTaskRow[];
  storage: Storage;
}

async function dispatchStage(args: DispatchArgs): Promise<{ status: "completed" | "failed" }> {
  switch (args.stage) {
    case "noop":
      process.stderr.write(
        `task ${args.taskRow.id}: state already completed; status corrected to 'completed'\n`,
      );
      return { status: "completed" };
    case "summarizer":
      throw new Error("summarizer stage: not implemented yet (Task 2.6)");
    case "refix-planning":
      throw new Error("refix-planning stage: not implemented yet (Task 2.6)");
    case "workers":
      throw new Error("workers stage: not implemented yet (Task 2.6)");
    case "triage":
      throw new Error("triage stage: not implemented yet (Task 2.6)");
  }
}
