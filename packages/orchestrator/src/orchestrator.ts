import {
  currentWorkspace,
  log as cmuxLog,
  setStatus,
  clearStatus,
  type WorkspaceRef,
} from "@agent-teams/cmux-adapter";
import {
  initAgentDir,
  initTaskDir,
  readReport,
  Storage,
  summaryFile,
  taskDir,
  writeSummary,
  writeTaskSnapshot,
} from "@agent-teams/storage";
import { join } from "node:path";
import { ulid } from "ulid";
import { loadAgentRegistry } from "./agent-registry.js";
import {
  buildInstanceInlineAgents,
  resolvePlannerInstance,
  resolveTeam,
} from "./instance.js";
import { runPlanner, runSummarizer, runTriage } from "./planner-runner.js";
import { loadTeam, validateTeamAgainstRegistry } from "./team.js";
import { runWorker } from "./worker-runner.js";

const DEFAULT_MAX_PARALLEL = 3;

export interface RunTaskOptions {
  description: string;
  cwd?: string;
  teamPath?: string;
}

export interface RunTaskResult {
  taskId: string;
  summaryPath: string;
  status: "completed" | "failed";
}

export async function runTask(opts: RunTaskOptions): Promise<RunTaskResult> {
  const cwd = opts.cwd ?? process.cwd();
  const teamPath = opts.teamPath ?? `${cwd}/agent-team.yaml`;
  const team = loadTeam(teamPath);

  const registry = loadAgentRegistry();
  validateTeamAgainstRegistry(team, registry);
  const workerInstances = resolveTeam(team, registry);
  const plannerInstance = resolvePlannerInstance(team, registry);
  const instancesByName = new Map(workerInstances.map((i) => [i.name, i]));
  const inlineAgents = buildInstanceInlineAgents([...workerInstances, plannerInstance]);
  const roleOf = (name: string): string | undefined =>
    instancesByName.get(name)?.role;

  const storage = new Storage();
  const taskId = ulid();

  initTaskDir(taskId);

  storage.insertTask({
    id: taskId,
    description: opts.description,
    cwd,
    team_name: team.name,
    status: "planning",
    created_at: Date.now(),
  });

  const workspace = await currentWorkspace().catch(() => null);

  try {
    if (workspace) {
      await setStatus({ workspace, key: "agent-teams", value: "triaging…", icon: "questionmark.circle" });
      await cmuxLog({ workspace, source: "agent-teams", message: `task ${taskId}: ${truncate(opts.description, 120)}` });
    }

    const fullRoster = workerInstances.map((i) => ({
      name: i.name,
      role: i.role,
      description: i.description,
    }));

    const triage = await runTriage({
      task: opts.description,
      cwd,
      team,
      plannerAgentName: plannerInstance.name,
      roster: fullRoster,
      eventsPath: join(taskDir(taskId), "triage-events.jsonl"),
      inlineAgents,
    });

    const selectedSet = new Set(triage.selectedAgents);
    const selectedInstances = workerInstances.filter((i) => selectedSet.has(i.name));
    if (selectedInstances.length === 0) {
      throw new Error(`triage selected no agents (roster: ${workerInstances.map((i) => i.name).join(", ")})`);
    }

    if (workspace) {
      await cmuxLog({
        workspace,
        source: "agent-teams",
        message: `triage: ${triage.difficulty} — picked ${triage.selectedAgents.join(", ")}`,
      });
      await setStatus({ workspace, key: "agent-teams", value: `planning (${triage.difficulty})…`, icon: "circle.dotted" });
    }

    const plan = await runPlanner({
      task: opts.description,
      cwd,
      team,
      plannerAgentName: plannerInstance.name,
      workers: selectedInstances.map((i) => ({
        name: i.name,
        role: i.role,
        description: i.description,
      })),
      difficulty: triage.difficulty,
      triageRationale: triage.rationale,
      eventsPath: join(taskDir(taskId), "planner-events.jsonl"),
      inlineAgents,
    });

    if (workspace) {
      await cmuxLog({ workspace, source: "agent-teams", message: `plan: ${plan.subTasks.length} sub-tasks — ${plan.subTasks.map((s) => s.assignedAgent).join(", ")}` });
    }

    const subTasks = plan.subTasks.map((sub, idx) => ({
      id: ulid(),
      index: idx,
      plan: sub,
    }));

    for (const { id, plan: sub } of subTasks) {
      storage.insertSubTask({
        id,
        task_id: taskId,
        title: sub.title,
        prompt: sub.prompt,
        assigned_agent: sub.assignedAgent,
        status: "pending",
        created_at: Date.now(),
      });
      initAgentDir(taskId, id);
    }

    writeTaskSnapshot({
      id: taskId,
      description: opts.description,
      cwd,
      team: team.name,
      status: "running",
      subTasks: subTasks.map(({ id, plan: sub }) => ({
        id,
        title: sub.title,
        assignedAgent: sub.assignedAgent,
        status: "pending",
      })),
      createdAt: Date.now(),
      completedAt: null,
    });

    storage.updateTaskStatus(taskId, "running");

    const maxParallel = team.defaults?.maxParallel ?? DEFAULT_MAX_PARALLEL;

    if (workspace) {
      await setStatus({ workspace, key: "agent-teams", value: "workers running…", icon: "figure.run" });
    }

    let completed = 0;
    const reportProgress = async () => {
      if (!workspace) return;
      await setStatus({
        workspace,
        key: "agent-teams",
        value: `${completed}/${subTasks.length} done`,
        icon: "hourglass",
      });
    };

    await runWithConcurrency(subTasks, maxParallel, async (entry) => {
      const runId = ulid();
      storage.insertAgentRun({
        id: runId,
        sub_task_id: entry.id,
        pane_ref: null,
        pid: null,
        started_at: Date.now(),
      });
      storage.updateSubTaskStatus(entry.id, "running");

      try {
        await runWorker({
          taskId,
          subTaskId: entry.id,
          agent: entry.plan.assignedAgent,
          originalTask: opts.description,
          subTaskTitle: entry.plan.title,
          subTaskPrompt: entry.plan.prompt,
          rationale: entry.plan.rationale,
          cwd,
          model: team.defaults?.model,
          inlineAgents,
        });
      } finally {
        completed++;
        await reportProgress().catch(() => {});
      }
    });

    if (workspace) {
      await setStatus({ workspace, key: "agent-teams", value: "summarizing…", icon: "sparkles" });
    }

    const subTaskReports = subTasks.map(({ id, plan: sub }) => ({
      title: sub.title,
      agent: sub.assignedAgent,
      role: roleOf(sub.assignedAgent),
      status: storage.db
        .prepare("SELECT status FROM sub_tasks WHERE id = ?")
        .pluck()
        .get(id) as string,
      report: readReport(taskId, id) ?? "",
    }));

    const summary = await runSummarizer({
      task: opts.description,
      cwd,
      team,
      subTaskReports,
      plannerAgentName: plannerInstance.name,
      eventsPath: join(taskDir(taskId), "summarizer-events.jsonl"),
      inlineAgents,
    });
    writeSummary(taskId, summary.summary);

    const failed = subTaskReports.some((r) => r.status === "failed");
    const status = failed ? "failed" : "completed";
    storage.updateTaskStatus(taskId, status, Date.now());

    writeTaskSnapshot({
      id: taskId,
      description: opts.description,
      cwd,
      team: team.name,
      status,
      subTasks: subTaskReports.map((r, i) => ({
        id: subTasks[i]!.id,
        title: r.title,
        assignedAgent: r.agent,
        status: r.status,
      })),
      createdAt: Date.now(),
      completedAt: Date.now(),
    });

    if (workspace) {
      await finalizeWorkspaceStatus(workspace, status, summaryFile(taskId), taskId);
    }

    return {
      taskId,
      summaryPath: summaryFile(taskId),
      status,
    };
  } catch (err) {
    storage.updateTaskStatus(taskId, "failed", Date.now());
    if (workspace) {
      await setStatus({
        workspace,
        key: "agent-teams",
        value: "error",
        icon: "exclamationmark.triangle",
        color: "#ef4444",
      }).catch(() => {});
    }
    throw err;
  } finally {
    storage.close();
    if (workspace) {
      setTimeout(() => {
        clearStatus({ workspace, key: "agent-teams" }).catch(() => {});
      }, 10_000).unref();
    }
  }
}

async function finalizeWorkspaceStatus(
  workspace: WorkspaceRef,
  status: "completed" | "failed",
  summaryPath: string,
  taskId: string,
): Promise<void> {
  await setStatus({
    workspace,
    key: "agent-teams",
    value: status === "completed" ? "done ✓" : "failed ✗",
    icon: status === "completed" ? "checkmark.circle" : "xmark.circle",
    color: status === "completed" ? "#4ade80" : "#ef4444",
  });
  await cmuxLog({
    workspace,
    source: "agent-teams",
    level: status === "completed" ? "info" : "error",
    message: `task ${taskId} ${status}. summary: ${summaryPath}`,
  });
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const cap = Math.max(1, limit);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(cap, items.length) }, async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export { taskDir };
