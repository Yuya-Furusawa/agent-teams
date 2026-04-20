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
  resolveWorkspaceTeam,
} from "./instance.js";
import { runPlanner, runSummarizer, runTriage } from "./planner-runner.js";
import { loadTeam, validateTeamAgainstRegistry } from "./team.js";
import { runWorker } from "./worker-runner.js";
import {
  loadWorkspace,
  workspaceRepoByName,
  type Repo,
  type Workspace,
} from "./workspace.js";

const DEFAULT_MAX_PARALLEL = 3;

export interface RunTaskOptions {
  description: string;
  cwd?: string;
  teamPath?: string;
  workspace?: string;
}

export interface RunTaskResult {
  taskId: string;
  summaryPath: string;
  status: "completed" | "failed";
}

export async function runTask(opts: RunTaskOptions): Promise<RunTaskResult> {
  const registry = loadAgentRegistry();

  let ws: Workspace | undefined;
  let team;
  let cwd: string;

  if (opts.workspace) {
    ws = loadWorkspace(opts.workspace);
    team = resolveWorkspaceTeam(ws.name, registry);
    // In workspace mode cwd is symbolic; each worker runs in its target repo.
    // Use the first repo as the planner/triage/summarizer cwd (they need *some* dir to run in).
    cwd = ws.repos[0]!.path;
  } else {
    cwd = opts.cwd ?? process.cwd();
    const teamPath = opts.teamPath ?? `${cwd}/agent-team.yaml`;
    team = loadTeam(teamPath);
  }

  validateTeamAgainstRegistry(team, registry);
  const workerInstances = resolveTeam(team, registry);
  const plannerInstance = resolvePlannerInstance(team, registry);
  const instancesByName = new Map(workerInstances.map((i) => [i.name, i]));
  const inlineAgents = buildInstanceInlineAgents([...workerInstances, plannerInstance]);
  const roleOf = (name: string): string | undefined =>
    instancesByName.get(name)?.role;
  const repos = ws?.repos;

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
    workspace_name: ws?.name ?? null,
    repos: ws ? JSON.stringify(ws.repos) : null,
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
      ...(repos ? { repos } : {}),
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
      ...(triage.rationale ? { triageRationale: triage.rationale } : {}),
      eventsPath: join(taskDir(taskId), "planner-events.jsonl"),
      inlineAgents,
      ...(repos ? { repos } : {}),
    });

    if (workspace) {
      await cmuxLog({ workspace, source: "agent-teams", message: `plan: ${plan.subTasks.length} sub-tasks — ${plan.subTasks.map((s) => s.assignedAgent).join(", ")}` });
    }

    const subTasks = plan.subTasks.map((sub, idx) => ({
      id: ulid(),
      index: idx,
      plan: sub,
    }));

    // Map planner-local ids (from plan.subTasks[i].id) to orchestrator-generated ULIDs
    // so dependsOn can be resolved against stored sub_task ids.
    const planIdToUlid = new Map<string, string>();
    for (const { id, plan: sub } of subTasks) planIdToUlid.set(sub.id, id);
    const dependsOnUlids = (sub: typeof plan.subTasks[number]): string[] =>
      (sub.dependsOn ?? []).map((d) => {
        const resolved = planIdToUlid.get(d);
        if (!resolved) {
          throw new Error(`sub-task "${sub.id}" depends on unknown id "${d}"`);
        }
        return resolved;
      });

    for (const { id, plan: sub } of subTasks) {
      const deps = dependsOnUlids(sub);
      storage.insertSubTask({
        id,
        task_id: taskId,
        title: sub.title,
        prompt: sub.prompt,
        assigned_agent: sub.assignedAgent,
        status: "pending",
        created_at: Date.now(),
        target_repo: sub.targetRepo ?? null,
        depends_on: deps.length > 0 ? JSON.stringify(deps) : null,
      });
      initAgentDir(taskId, id);
    }

    writeTaskSnapshot({
      id: taskId,
      description: opts.description,
      cwd,
      team: team.name,
      status: "running",
      workspace: ws?.name ?? null,
      repos: ws ? ws.repos : null,
      subTasks: subTasks.map(({ id, plan: sub }) => ({
        id,
        title: sub.title,
        assignedAgent: sub.assignedAgent,
        status: "pending",
        targetRepo: sub.targetRepo ?? null,
        dependsOn: dependsOnUlids(sub),
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

    const dagNodes = subTasks.map((entry) => ({
      id: entry.id,
      dependsOn: dependsOnUlids(entry.plan),
      item: entry,
    }));

    await runDag(dagNodes, maxParallel, async (entry) => {
      const runId = ulid();
      storage.insertAgentRun({
        id: runId,
        sub_task_id: entry.id,
        pane_ref: null,
        pid: null,
        started_at: Date.now(),
      });
      storage.updateSubTaskStatus(entry.id, "running");

      const { workerCwd, targetRepo, peerRepos } = resolveWorkerScope(
        ws,
        entry.plan.targetRepo,
        cwd,
      );

      try {
        await runWorker({
          taskId,
          subTaskId: entry.id,
          agent: entry.plan.assignedAgent,
          originalTask: opts.description,
          subTaskTitle: entry.plan.title,
          subTaskPrompt: entry.plan.prompt,
          ...(entry.plan.rationale ? { rationale: entry.plan.rationale } : {}),
          cwd: workerCwd,
          ...(team.defaults?.model ? { model: team.defaults.model } : {}),
          inlineAgents,
          ...(targetRepo ? { targetRepo } : {}),
          ...(peerRepos && peerRepos.length > 0 ? { peerRepos } : {}),
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
      ...(roleOf(sub.assignedAgent) ? { role: roleOf(sub.assignedAgent)! } : {}),
      status: storage.db
        .prepare("SELECT status FROM sub_tasks WHERE id = ?")
        .pluck()
        .get(id) as string,
      report: readReport(taskId, id) ?? "",
      targetRepo: sub.targetRepo ?? null,
    }));

    const summary = await runSummarizer({
      task: opts.description,
      cwd,
      team,
      subTaskReports,
      plannerAgentName: plannerInstance.name,
      eventsPath: join(taskDir(taskId), "summarizer-events.jsonl"),
      inlineAgents,
      ...(repos ? { repos } : {}),
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
      workspace: ws?.name ?? null,
      repos: ws ? ws.repos : null,
      subTasks: subTaskReports.map((r, i) => ({
        id: subTasks[i]!.id,
        title: r.title,
        assignedAgent: r.agent,
        status: r.status,
        targetRepo: r.targetRepo ?? null,
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

function resolveWorkerScope(
  workspace: Workspace | undefined,
  targetRepoName: string | undefined,
  fallbackCwd: string,
): {
  workerCwd: string;
  targetRepo?: Repo;
  peerRepos?: Repo[];
} {
  if (!workspace) return { workerCwd: fallbackCwd };
  const repo = workspaceRepoByName(workspace, targetRepoName) ?? workspace.repos[0]!;
  const peers = workspace.repos.filter((r) => r.name !== repo.name);
  return { workerCwd: repo.path, targetRepo: repo, peerRepos: peers };
}

interface DagNode<T> {
  id: string;
  dependsOn: string[];
  item: T;
}

/**
 * Runs each node once its `dependsOn` nodes have all completed (success OR failure).
 * Inflight work is globally capped at `limit`. A dependency failure does not stop
 * dependents from running — the worker itself decides how to react to missing
 * upstream output (e.g. a reviewer can note "nothing to review"). Cycles and
 * missing references are expected to be caught earlier by validatePlanDag; they
 * are re-detected here as a safety net.
 */
async function runDag<T>(
  nodes: DagNode<T>[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const cap = Math.max(1, limit);
  const done = new Set<string>();
  const inflight = new Map<string, Promise<void>>();
  const pending = new Map<string, DagNode<T>>();
  for (const n of nodes) pending.set(n.id, n);

  const canStart = (n: DagNode<T>): boolean => n.dependsOn.every((d) => done.has(d));

  while (pending.size > 0 || inflight.size > 0) {
    for (const [id, node] of pending) {
      if (inflight.size >= cap) break;
      if (!canStart(node)) continue;
      pending.delete(id);
      const p = fn(node.item)
        .catch(() => {
          // Swallow: the worker's try/finally below already records status;
          // we still want dependents to unblock so the pipeline makes progress.
        })
        .finally(() => {
          done.add(id);
          inflight.delete(id);
        });
      inflight.set(id, p);
    }
    if (inflight.size === 0 && pending.size > 0) {
      const stuck = [...pending.keys()].join(", ");
      throw new Error(`DAG deadlocked (cycle or missing dep) at: ${stuck}`);
    }
    await Promise.race(inflight.values());
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export { taskDir };
