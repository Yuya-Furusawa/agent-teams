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
  type SubTaskStatus,
} from "@agent-teams/storage";
import type { InlineAgentDefinition } from "@agent-teams/agent-runner";
import { join } from "node:path";
import { ulid } from "ulid";
import { loadAgentRegistry } from "./agent-registry.js";
import {
  buildInstanceInlineAgents,
  resolvePlannerInstance,
  resolveTeam,
  resolveWorkspaceTeam,
} from "./instance.js";
import { runPlanner, runRefixPlanner, runSummarizer, runTriage } from "./planner-runner.js";
import { parseDesignCheckpoint, type DesignCheckpoint } from "./checkpoint-parse.js";
import type { SubTaskPlan } from "./planner-schema.js";
import { loadPbiConfig } from "./pbi-config.js";
import { buildPbiTaskDescription, parsePbiNumber } from "./pbi-input.js";
import { resolvePbiPath } from "./pbi-numbering.js";
import { loadTeam, validateTeamAgainstRegistry, type Team } from "./team.js";
import { runWorker } from "./worker-runner.js";
import {
  loadWorkspace,
  scanDesignFiles,
  workspaceRepoByName,
  type Repo,
  type Workspace,
} from "./workspace.js";
import { readFileSync } from "node:fs";

export interface SubTaskEntry {
  id: string;
  index: number;
  plan: SubTaskPlan;
}

export class DesignCheckpointReached extends Error {
  readonly designerSubTaskId: string;
  readonly checkpoint: DesignCheckpoint;
  readonly completedIds: ReadonlySet<string>;
  constructor(payload: {
    designerSubTaskId: string;
    checkpoint: DesignCheckpoint;
    completedIds: ReadonlySet<string>;
  }) {
    super(`design checkpoint reached for sub-task ${payload.designerSubTaskId}`);
    this.name = "DesignCheckpointReached";
    this.designerSubTaskId = payload.designerSubTaskId;
    this.checkpoint = payload.checkpoint;
    this.completedIds = payload.completedIds;
  }
}

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
  let description = opts.description;
  let inputKind: "freeform" | "pbi" = "freeform";

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

  // ===== PBI 番号入力の解決 =====
  const pbiNum = parsePbiNumber(description);
  if (pbiNum !== null) {
    const pbiCfg = loadPbiConfig(ws ? { workspace: ws } : { cwd });
    const path = resolvePbiPath(pbiCfg, pbiNum);
    const md = readFileSync(path, "utf8");
    description = buildPbiTaskDescription(pbiNum, md);
    inputKind = "pbi";
  }

  validateTeamAgainstRegistry(team, registry);
  const workerInstances = resolveTeam(team, registry);
  const plannerInstance = resolvePlannerInstance(team, registry);
  const instancesByName = new Map(workerInstances.map((i) => [i.name, i]));
  const inlineAgents = buildInstanceInlineAgents([...workerInstances, plannerInstance]);
  const roleOf = (name: string): string | undefined =>
    instancesByName.get(name)?.role;
  // Pre-scan target repos (or the local cwd in single-repo mode) for `.pen`
  // design files. The result feeds the triage/planner prompts so Sage knows
  // when to include Hana. Always pass the scanned list — single-repo mode
  // uses a synthetic "(local)" entry so the same surface works in both modes.
  const baseRepos: Repo[] = ws?.repos ?? [{ name: "(local)", path: cwd, role: "" }];
  const reposWithDesign = scanDesignFiles(baseRepos);
  const repos = reposWithDesign;

  const storage = new Storage();
  const taskId = ulid();

  initTaskDir(taskId);

  storage.insertTask({
    id: taskId,
    description,
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
      await cmuxLog({ workspace, source: "agent-teams", message: `task ${taskId}: ${truncate(description, 120)}` });
    }

    const fullRoster = workerInstances.map((i) => ({
      name: i.name,
      role: i.role,
      description: i.description,
    }));

    let triageOutput: {
      difficulty: "trivial" | "small" | "medium" | "large" | "xlarge";
      selectedAgents: string[];
      rationale?: string;
    };

    if (inputKind === "pbi") {
      // PBI 入力: triage をバイパス。フルロスター + difficulty 固定。
      triageOutput = {
        difficulty: "medium",
        selectedAgents: workerInstances.map((i) => i.name),
      };
      if (workspace) {
        await cmuxLog({
          workspace,
          source: "agent-teams",
          message: `pbi input: triage bypassed, full roster (${triageOutput.selectedAgents.length} agents)`,
        });
      }
    } else {
      triageOutput = await runTriage({
        task: description,
        cwd,
        team,
        plannerAgentName: plannerInstance.name,
        roster: fullRoster,
        eventsPath: join(taskDir(taskId), "triage-events.jsonl"),
        inlineAgents,
        ...(repos ? { repos } : {}),
      });
    }

    const selectedSet = new Set(triageOutput.selectedAgents);
    const selectedInstances = workerInstances.filter((i) => selectedSet.has(i.name));
    if (selectedInstances.length === 0) {
      throw new Error(`triage selected no agents (roster: ${workerInstances.map((i) => i.name).join(", ")})`);
    }

    if (workspace) {
      await cmuxLog({
        workspace,
        source: "agent-teams",
        message: `triage: ${triageOutput.difficulty} — picked ${triageOutput.selectedAgents.join(", ")}`,
      });
      await setStatus({ workspace, key: "agent-teams", value: `planning (${triageOutput.difficulty})…`, icon: "circle.dotted" });
    }

    const plan = await runPlanner({
      task: description,
      cwd,
      team,
      plannerAgentName: plannerInstance.name,
      workers: selectedInstances.map((i) => ({
        name: i.name,
        role: i.role,
        description: i.description,
      })),
      difficulty: triageOutput.difficulty,
      ...(triageOutput.rationale ? { triageRationale: triageOutput.rationale } : {}),
      eventsPath: join(taskDir(taskId), "planner-events.jsonl"),
      inlineAgents,
      ...(repos ? { repos } : {}),
      roleOf,
    });

    if (workspace) {
      await cmuxLog({ workspace, source: "agent-teams", message: `plan: ${plan.subTasks.length} sub-tasks — ${plan.subTasks.map((s) => s.assignedAgent).join(", ")}` });
    }

    const maxParallel = team.defaults?.maxParallel ?? DEFAULT_MAX_PARALLEL;

    // ===== Round 1 =====
    const round1Entries = prepareRound({ storage, taskId, plan, round: 1 });

    const round1PlanIdToUlid = new Map<string, string>();
    for (const e of round1Entries) round1PlanIdToUlid.set(e.plan.id, e.id);

    writeTaskSnapshot({
      id: taskId,
      description,
      cwd,
      team: team.name,
      status: "running",
      workspace: ws?.name ?? null,
      repos: ws ? ws.repos : null,
      subTasks: round1Entries.map((e) => ({
        id: e.id,
        title: e.plan.title,
        assignedAgent: e.plan.assignedAgent,
        status: "pending",
        targetRepo: e.plan.targetRepo ?? null,
        dependsOn: (e.plan.dependsOn ?? [])
          .map((d) => round1PlanIdToUlid.get(d))
          .filter((x): x is string => Boolean(x)),
        round: 1,
      })),
      createdAt: Date.now(),
      completedAt: null,
    });

    storage.updateTaskStatus(taskId, "running");

    if (workspace) {
      await setStatus({ workspace, key: "agent-teams", value: "workers running…", icon: "figure.run" });
    }

    await runRoundDag({
      entries: round1Entries,
      storage, taskId, ws, cwd, team, inlineAgents,
      originalTaskDescription: description,
      maxParallel,
      workspace,
      round: 1,
    });

    const { round2Entries, refixSkipReason } = await runRefixPhase({
      storage,
      taskId,
      description,
      cwd,
      team,
      ws,
      workspace,
      inlineAgents,
      plannerAgentName: plannerInstance.name,
      round1Entries,
      roleOf,
      maxParallel,
      repos,
    });

    if (workspace) {
      await setStatus({ workspace, key: "agent-teams", value: "summarizing…", icon: "sparkles" });
    }

    const { status, subTaskReports } = await runSummaryPhase({
      storage,
      taskId,
      description,
      cwd,
      team,
      inlineAgents,
      plannerAgentName: plannerInstance.name,
      round1Entries,
      round2Entries,
      roleOf,
      refixSkipReason,
      repos,
    });

    writeTaskSnapshot({
      id: taskId,
      description,
      cwd,
      team: team.name,
      status,
      workspace: ws?.name ?? null,
      repos: ws ? ws.repos : null,
      subTasks: subTaskReports.map((r) => ({
        id: r.id,
        title: r.title,
        assignedAgent: r.agent,
        status: r.status,
        targetRepo: r.targetRepo ?? null,
        round: r.round,
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

export async function runRefixPhase(params: {
  storage: Storage;
  taskId: string;
  description: string;
  cwd: string;
  team: Team;
  ws: Workspace | undefined;
  workspace: WorkspaceRef | null;
  inlineAgents: Record<string, InlineAgentDefinition>;
  plannerAgentName: string;
  round1Entries: SubTaskEntry[];
  roleOf: (name: string) => string | undefined;
  maxParallel: number;
  repos: Workspace["repos"] | undefined;
}): Promise<{
  round2Entries: SubTaskEntry[];
  refixSkipReason: string | undefined;
}> {
  const {
    storage,
    taskId,
    description,
    cwd,
    team,
    ws,
    workspace,
    inlineAgents,
    plannerAgentName,
    round1Entries,
    roleOf,
    maxParallel,
    repos,
  } = params;

  if (workspace) {
    await setStatus({ workspace, key: "agent-teams", value: "refix planning…", icon: "arrow.clockwise" });
  }

  const round1ReportInputs = round1Entries.map((e) => ({
    subTaskId: e.id,
    title: e.plan.title,
    assignedAgent: e.plan.assignedAgent,
    role: roleOf(e.plan.assignedAgent),
    status: storage.getSubTaskStatus(e.id),
    report: readReport(taskId, e.id) ?? "",
    targetRepo: e.plan.targetRepo ?? null,
  }));

  const originalPlanEntries = round1Entries.map((e) => ({
    id: e.plan.id,
    title: e.plan.title,
    prompt: e.plan.prompt,
    assignedAgent: e.plan.assignedAgent,
    targetRepo: e.plan.targetRepo ?? null,
  }));

  const roundOneHadReviewers = round1Entries.some((e) => {
    const role = roleOf(e.plan.assignedAgent) ?? "";
    return role.endsWith("-reviewer");
  });

  let round2Entries: SubTaskEntry[] = [];
  let refixSkipReason: string | undefined;

  if (!roundOneHadReviewers) {
    refixSkipReason = "Round 1 had no reviewers — refix phase skipped.";
    if (workspace) {
      await cmuxLog({ workspace, source: "agent-teams", message: refixSkipReason });
    }
  } else {
    const allowedAssignees = [
      ...new Set(round1Entries.map((e) => e.plan.assignedAgent)),
    ];

    const refixPlan = await runRefixPlanner({
      task: description,
      cwd,
      team,
      plannerAgentName,
      round1Reports: round1ReportInputs,
      originalPlan: originalPlanEntries,
      allowedAssignees,
      eventsPath: join(taskDir(taskId), "refix-planner-events.jsonl"),
      inlineAgents,
      ...(repos ? { repos } : {}),
      roleOf,
    });

    if (refixPlan.subTasks.length === 0) {
      refixSkipReason = refixPlan.overallStrategy;
      if (workspace) {
        await cmuxLog({
          workspace,
          source: "agent-teams",
          message: `no refix needed: ${truncate(refixPlan.overallStrategy, 120)}`,
        });
      }
    } else {
      // Warn (fail open) if Sage reassigned to an agent not in round 1.
      const round1Agents = new Set(round1Entries.map((e) => e.plan.assignedAgent));
      for (const sub of refixPlan.subTasks) {
        if (!round1Agents.has(sub.assignedAgent) && workspace) {
          await cmuxLog({
            workspace,
            source: "agent-teams",
            level: "warn",
            message: `refix sub-task "${sub.title}" assigned to ${sub.assignedAgent} (not present in round 1)`,
          });
        }
      }

      // ===== Round 2 =====
      round2Entries = prepareRound({ storage, taskId, plan: refixPlan, round: 2 });

      const round1PlanIdToUlid = new Map<string, string>();
      for (const e of round1Entries) round1PlanIdToUlid.set(e.plan.id, e.id);
      const round2PlanIdToUlid = new Map<string, string>();
      for (const e of round2Entries) round2PlanIdToUlid.set(e.plan.id, e.id);

      writeTaskSnapshot({
        id: taskId,
        description,
        cwd,
        team: team.name,
        status: "running",
        workspace: ws?.name ?? null,
        repos: ws ? ws.repos : null,
        subTasks: [
          ...round1Entries.map((e) => ({
            id: e.id,
            title: e.plan.title,
            assignedAgent: e.plan.assignedAgent,
            status: storage.getSubTaskStatus(e.id),
            targetRepo: e.plan.targetRepo ?? null,
            dependsOn: (e.plan.dependsOn ?? [])
              .map((d) => round1PlanIdToUlid.get(d))
              .filter((x): x is string => Boolean(x)),
            round: 1 as const,
          })),
          ...round2Entries.map((e) => ({
            id: e.id,
            title: e.plan.title,
            assignedAgent: e.plan.assignedAgent,
            status: "pending" as const,
            targetRepo: e.plan.targetRepo ?? null,
            dependsOn: (e.plan.dependsOn ?? [])
              .map((d) => round2PlanIdToUlid.get(d))
              .filter((x): x is string => Boolean(x)),
            round: 2 as const,
          })),
        ],
        createdAt: Date.now(),
        completedAt: null,
      });

      if (workspace) {
        await setStatus({
          workspace,
          key: "agent-teams",
          value: `refix 0/${round2Entries.length}`,
          icon: "arrow.clockwise",
        });
      }

      await runRoundDag({
        entries: round2Entries,
        storage, taskId, ws, cwd, team, inlineAgents,
        originalTaskDescription: description,
        maxParallel,
        workspace,
        round: 2,
      });
    }
  }

  return { round2Entries, refixSkipReason };
}

export async function runSummaryPhase(params: {
  storage: Storage;
  taskId: string;
  description: string;
  cwd: string;
  team: Team;
  inlineAgents: Record<string, InlineAgentDefinition>;
  plannerAgentName: string;
  round1Entries: SubTaskEntry[];
  round2Entries: SubTaskEntry[];
  roleOf: (name: string) => string | undefined;
  refixSkipReason: string | undefined;
  repos: Workspace["repos"] | undefined;
}): Promise<{
  status: "completed" | "failed";
  subTaskReports: Array<{
    id: string;
    title: string;
    agent: string;
    role?: string;
    status: SubTaskStatus;
    report: string;
    targetRepo: string | null;
    round: 1 | 2;
  }>;
}> {
  const {
    storage,
    taskId,
    description,
    cwd,
    team,
    inlineAgents,
    plannerAgentName,
    round1Entries,
    round2Entries,
    roleOf,
    refixSkipReason,
    repos,
  } = params;

  const allEntries: Array<{ entry: SubTaskEntry; round: 1 | 2 }> = [
    ...round1Entries.map((e) => ({ entry: e, round: 1 as const })),
    ...round2Entries.map((e) => ({ entry: e, round: 2 as const })),
  ];

  const subTaskReports = allEntries.map(({ entry, round }) => {
    const role = roleOf(entry.plan.assignedAgent);
    return {
      id: entry.id,
      title: entry.plan.title,
      agent: entry.plan.assignedAgent,
      ...(role ? { role } : {}),
      status: storage.getSubTaskStatus(entry.id),
      report: readReport(taskId, entry.id) ?? "",
      targetRepo: entry.plan.targetRepo ?? null,
      round,
    };
  });

  const summary = await runSummarizer({
    task: description,
    cwd,
    team,
    subTaskReports,
    plannerAgentName,
    eventsPath: join(taskDir(taskId), "summarizer-events.jsonl"),
    inlineAgents,
    ...(refixSkipReason ? { refixSkipReason } : {}),
    ...(repos ? { repos } : {}),
  });
  writeSummary(taskId, summary.summary);

  const failed = subTaskReports.some((r) => r.status === "failed");
  const status: "completed" | "failed" = failed ? "failed" : "completed";
  storage.updateTaskStatus(taskId, status, Date.now());

  return { status, subTaskReports };
}

export function prepareRound(params: {
  storage: Storage;
  taskId: string;
  plan: { subTasks: SubTaskPlan[] };
  round: 1 | 2;
}): SubTaskEntry[] {
  const entries: SubTaskEntry[] = params.plan.subTasks.map((sub, idx) => ({
    id: ulid(),
    index: idx,
    plan: sub,
  }));
  const planIdToUlid = new Map<string, string>();
  for (const { id, plan: sub } of entries) planIdToUlid.set(sub.id, id);
  for (const { id, plan: sub } of entries) {
    const deps = (sub.dependsOn ?? []).map((d) => {
      const resolved = planIdToUlid.get(d);
      if (!resolved) throw new Error(`sub-task "${sub.id}" depends on unknown id "${d}"`);
      return resolved;
    });
    params.storage.insertSubTask({
      id,
      task_id: params.taskId,
      title: sub.title,
      prompt: sub.prompt,
      assigned_agent: sub.assignedAgent,
      status: "pending",
      created_at: Date.now(),
      target_repo: sub.targetRepo ?? null,
      depends_on: deps.length > 0 ? JSON.stringify(deps) : null,
      round: params.round,
    });
    initAgentDir(params.taskId, id);
  }
  return entries;
}

export async function runRoundDag(params: {
  entries: SubTaskEntry[];
  storage: Storage;
  taskId: string;
  ws: Workspace | undefined;
  cwd: string;
  team: Team;
  inlineAgents: Record<string, InlineAgentDefinition>;
  originalTaskDescription: string;
  maxParallel: number;
  workspace: WorkspaceRef | null;
  round: 1 | 2;
  preCompletedIds?: ReadonlySet<string>;
}): Promise<void> {
  const planIdToUlid = new Map<string, string>();
  for (const e of params.entries) planIdToUlid.set(e.plan.id, e.id);
  const dagNodes = params.entries.map((entry) => ({
    id: entry.id,
    dependsOn: (entry.plan.dependsOn ?? [])
      .map((d) => planIdToUlid.get(d)!)
      .filter((x) => x !== undefined),
    item: entry,
  }));

  let completed = 0;
  const total = params.entries.length;
  const reportProgress = async () => {
    if (!params.workspace) return;
    const prefix = params.round === 2 ? "refix " : "";
    await setStatus({
      workspace: params.workspace,
      key: "agent-teams",
      value: `${prefix}${completed}/${total} done`,
      icon: "hourglass",
    });
  };

  const completedIds = new Set<string>();
  let designCheckpointPayload: DesignCheckpoint | null = null;
  let designCheckpointId: string | null = null;

  await runDag(
    dagNodes,
    params.maxParallel,
    async (entry) => {
      const runId = ulid();
      params.storage.insertAgentRun({
        id: runId,
        sub_task_id: entry.id,
        pane_ref: null,
        pid: null,
        started_at: Date.now(),
      });
      params.storage.updateSubTaskStatus(entry.id, "running");
      const { workerCwd, targetRepo, peerRepos } = resolveWorkerScope(
        params.ws,
        entry.plan.targetRepo ?? undefined,
        params.cwd,
      );
      try {
        await runWorker({
          taskId: params.taskId,
          subTaskId: entry.id,
          agent: entry.plan.assignedAgent,
          originalTask: params.originalTaskDescription,
          subTaskTitle: entry.plan.title,
          subTaskPrompt: entry.plan.prompt,
          ...(entry.plan.rationale ? { rationale: entry.plan.rationale } : {}),
          cwd: workerCwd,
          ...(params.team.defaults?.model ? { model: params.team.defaults.model } : {}),
          inlineAgents: params.inlineAgents,
          ...(targetRepo ? { targetRepo } : {}),
          ...(peerRepos && peerRepos.length > 0 ? { peerRepos } : {}),
        });
      } finally {
        completed++;
        await reportProgress().catch(() => {});
        completedIds.add(entry.id);

        // Detect Hana's design checkpoint. Hana is the sole layer-0 node when
        // present (enforced by validatePlanDag), so when this fires no other
        // round-1 worker is in flight.
        if (entry.plan.assignedAgent === "Hana") {
          const report = readReport(params.taskId, entry.id) ?? "";
          const checkpoint = parseDesignCheckpoint(report);
          if (checkpoint && checkpoint.modified_files.length > 0) {
            designCheckpointPayload = checkpoint;
            designCheckpointId = entry.id;
          }
        }
      }
    },
    params.preCompletedIds ? { preCompletedIds: params.preCompletedIds } : undefined,
  );

  if (designCheckpointPayload && designCheckpointId) {
    throw new DesignCheckpointReached({
      designerSubTaskId: designCheckpointId,
      checkpoint: designCheckpointPayload,
      completedIds,
    });
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

export function resolveWorkerScope(
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
export async function runDag<T>(
  nodes: DagNode<T>[],
  limit: number,
  fn: (item: T) => Promise<void>,
  opts?: { preCompletedIds?: ReadonlySet<string> },
): Promise<void> {
  const cap = Math.max(1, limit);
  const done = new Set<string>(opts?.preCompletedIds ?? []);
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

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export { taskDir };
