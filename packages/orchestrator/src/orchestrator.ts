import {
  currentWorkspace,
  log as cmuxLog,
  newTerminalPane,
  renameTab,
  sendKey,
  send,
  setStatus,
  clearStatus,
  type SurfaceRef,
  type SplitDirection,
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
  type AgentInstance,
} from "./instance.js";
import { runPlanner, runSummarizer } from "./planner-runner.js";
import type { SubTaskPlan } from "./planner-schema.js";
import { loadTeam, validateTeamAgainstRegistry } from "./team.js";

const SPLIT_CYCLE: SplitDirection[] = ["right", "down", "right", "down"];
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
      await setStatus({ workspace, key: "agent-teams", value: "planning…", icon: "circle.dotted" });
      await cmuxLog({ workspace, source: "agent-teams", message: `task ${taskId} planning: ${truncate(opts.description, 120)}` });
    }

    const plan = await runPlanner({
      task: opts.description,
      cwd,
      team,
      plannerAgentName: plannerInstance.name,
      workers: workerInstances.map((i) => ({
        name: i.name,
        role: i.role,
        description: i.description,
      })),
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

    const _maxParallel = team.defaults?.maxParallel ?? DEFAULT_MAX_PARALLEL;
    if (!workspace) {
      throw new Error("could not locate active cmux workspace — is cmux running?");
    }
    const surfaces = await provisionSurfaces({ workspace, count: subTasks.length });

    await Promise.all(
      subTasks.map(async (entry, i) => {
        const surface = surfaces[i];
        if (!surface) throw new Error(`no surface allocated for sub-task ${i}`);
        await dispatchWorker({
          storage,
          taskId,
          subTaskId: entry.id,
          plan: entry.plan,
          surface,
          workspace,
        });
      }),
    );

    if (workspace) {
      await setStatus({ workspace, key: "agent-teams", value: "workers running…", icon: "figure.run" });
    }

    await waitForAllSubTasks(storage, taskId, subTasks.length, {
      onProgress: async (done, total) => {
        if (workspace) {
          await setStatus({
            workspace,
            key: "agent-teams",
            value: `${done}/${total} done`,
            icon: "hourglass",
          });
        }
      },
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
        message: `task ${taskId} ${status}. summary: ${summaryFile(taskId)}`,
      });
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

async function provisionSurfaces(opts: {
  workspace: WorkspaceRef;
  count: number;
}): Promise<SurfaceRef[]> {
  const created: SurfaceRef[] = [];
  for (let i = 0; i < opts.count; i++) {
    const direction = SPLIT_CYCLE[i % SPLIT_CYCLE.length]!;
    const { surface } = await newTerminalPane({
      direction,
      workspace: opts.workspace,
      type: "terminal",
    });
    created.push(surface);
  }
  return created;
}

async function dispatchWorker(opts: {
  storage: Storage;
  taskId: string;
  subTaskId: string;
  plan: SubTaskPlan;
  surface: SurfaceRef;
  workspace: WorkspaceRef;
}): Promise<void> {
  const runId = ulid();
  opts.storage.insertAgentRun({
    id: runId,
    sub_task_id: opts.subTaskId,
    pane_ref: opts.surface,
    pid: null,
    started_at: Date.now(),
  });
  opts.storage.updateSubTaskStatus(opts.subTaskId, "running");

  await renameTab({
    workspace: opts.workspace,
    surface: opts.surface,
    title: `${opts.plan.assignedAgent} · ${truncate(opts.plan.title, 30)}`,
  }).catch(() => {});
  const cmd = `agent-teams-internal worker ${opts.taskId} ${opts.subTaskId}`;
  await send({ workspace: opts.workspace, surface: opts.surface, text: cmd });
  await sendKey({ workspace: opts.workspace, surface: opts.surface, key: "Enter" });
}

async function waitForAllSubTasks(
  storage: Storage,
  taskId: string,
  expected: number,
  opts: { onProgress?: (done: number, total: number) => Promise<void> | void; pollMs?: number } = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? 1_000;
  let lastDone = -1;
  for (;;) {
    const rows = storage.db
      .prepare(`SELECT status FROM sub_tasks WHERE task_id = ?`)
      .all(taskId) as Array<{ status: string }>;
    const done = rows.filter((r) => r.status === "completed" || r.status === "failed").length;
    if (done !== lastDone) {
      lastDone = done;
      if (opts.onProgress) await opts.onProgress(done, expected);
    }
    if (done >= expected) return;
    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export { taskDir };
