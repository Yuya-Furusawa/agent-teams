import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join as joinPath } from "node:path";
import {
  Storage,
  eventsFile,
  reportFile,
  rotateBackup,
  summaryFile,
  type ResumeLock,
  type SubTaskRow,
  type TaskRow,
} from "@agent-teams/storage";
import type { InlineAgentDefinition } from "@agent-teams/agent-runner";
import { loadAgentRegistry } from "./agent-registry.js";
import {
  buildInstanceInlineAgents,
  resolvePlannerInstance,
  resolveTeam,
  resolveWorkspaceTeam,
} from "./instance.js";
import {
  prepareRound,
  runRefixPhase,
  runRoundDag,
  runSummaryPhase,
  taskDir,
  type SubTaskEntry,
} from "./orchestrator.js";
import { runPlanner, runTriage } from "./planner-runner.js";
import { loadTeam, type Team } from "./team.js";
import { loadWorkspace, type Workspace } from "./workspace.js";

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

interface StageContext {
  team: Team;
  ws: Workspace | undefined;
  cwd: string;
  workerInstances: ReturnType<typeof resolveTeam>;
  plannerName: string;
  inlineAgents: Record<string, InlineAgentDefinition>;
  roleOf: (n: string) => string | undefined;
  maxParallel: number;
  repos: Workspace["repos"] | undefined;
}

async function loadStageContext(task: TaskRow): Promise<StageContext> {
  const registry = loadAgentRegistry();
  const ws = task.workspace_name ? loadWorkspace(task.workspace_name) : undefined;
  const team = ws
    ? resolveWorkspaceTeam(ws.name, registry)
    : loadTeam(`${task.cwd}/agent-team.yaml`);
  const workerInstances = resolveTeam(team, registry);
  const plannerInstance = resolvePlannerInstance(team, registry);
  const inlineAgents = buildInstanceInlineAgents([...workerInstances, plannerInstance]);
  const byName = new Map(workerInstances.map((i) => [i.name, i.role]));
  const roleOf = (n: string) => byName.get(n);
  const cwd = ws ? ws.repos[0]!.path : task.cwd;
  const maxParallel = team.defaults?.maxParallel ?? 3;
  return {
    team, ws, cwd, workerInstances, plannerName: plannerInstance.name,
    inlineAgents, roleOf, maxParallel,
    repos: ws ? ws.repos : undefined,
  };
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
    case "summarizer":   return runSummarizerStage(args);
    case "refix-planning": return runRefixStage(args);
    case "workers":      return runWorkersStage(args);
    case "triage":       return runTriageStage(args);
  }
}

async function runWorkersStage(args: DispatchArgs): Promise<{ status: "completed" | "failed" }> {
  const ctx = await loadStageContext(args.taskRow);

  const incomplete = args.subTasks.filter((s) => s.status !== "completed");
  const completedIds = new Set(args.subTasks.filter((s) => s.status === "completed").map((s) => s.id));

  // Backup events.jsonl + report.md before retry, then mark sub-tasks 'pending'.
  for (const s of incomplete) {
    rotateBackup(eventsFile(args.taskRow.id, s.id), 3);
    rotateBackup(reportFile(args.taskRow.id, s.id), 3);
    args.storage.updateSubTaskStatus(s.id, "pending");
  }

  // Build SubTaskEntry shape from DB rows. depends_on already stores ULIDs.
  const entriesById = new Map<string, SubTaskEntry>();
  for (const s of args.subTasks) {
    const deps = s.depends_on ? (JSON.parse(s.depends_on) as string[]) : [];
    entriesById.set(s.id, {
      id: s.id, index: 0,
      plan: {
        id: s.id, title: s.title, prompt: s.prompt,
        assignedAgent: s.assigned_agent,
        ...(s.target_repo ? { targetRepo: s.target_repo } : {}),
        dependsOn: deps,
      },
    });
  }

  // Spec calls for a single runDag with preCompletedIds, but we split per-round
  // because runRoundDag carries round-specific status text (the GUI shows
  // "0/N done" vs. "refix 0/N done"). The cost is two cycles of acquire/release
  // when both rounds need work, which is rare enough to not matter in practice.
  const round1Incomplete = incomplete.filter((s) => s.round === 1).map((s) => entriesById.get(s.id)!);
  const round2Incomplete = incomplete.filter((s) => s.round === 2).map((s) => entriesById.get(s.id)!);

  if (round1Incomplete.length > 0) {
    await runRoundDag({
      entries: round1Incomplete,
      storage: args.storage,
      taskId: args.taskRow.id,
      ws: ctx.ws,
      cwd: ctx.cwd,
      team: ctx.team,
      inlineAgents: ctx.inlineAgents,
      originalTaskDescription: args.taskRow.description,
      maxParallel: ctx.maxParallel,
      workspace: null,
      round: 1,
      preCompletedIds: completedIds,
    });
  }

  // After round 1 retry, rebuild round1Entries (full list) for the refix decision.
  const refreshed = args.storage.listSubTasks(args.taskRow.id);
  const round1Entries = refreshed.filter((s) => s.round === 1).map((s) => entriesById.get(s.id)!);
  const existingRound2 = refreshed.filter((s) => s.round === 2);

  let round2Entries: SubTaskEntry[];
  let refixSkipReason: string | undefined;
  if (existingRound2.length > 0) {
    if (round2Incomplete.length > 0) {
      const completedIdsR2 = new Set(refreshed.filter((s) => s.status === "completed").map((s) => s.id));
      await runRoundDag({
        entries: round2Incomplete,
        storage: args.storage,
        taskId: args.taskRow.id,
        ws: ctx.ws,
        cwd: ctx.cwd,
        team: ctx.team,
        inlineAgents: ctx.inlineAgents,
        originalTaskDescription: args.taskRow.description,
        maxParallel: ctx.maxParallel,
        workspace: null,
        round: 2,
        preCompletedIds: completedIdsR2,
      });
    }
    round2Entries = existingRound2.map((s) => entriesById.get(s.id)!);
  } else {
    const phaseResult = await runRefixPhase({
      storage: args.storage, taskId: args.taskRow.id,
      description: args.taskRow.description, cwd: ctx.cwd,
      team: ctx.team, ws: ctx.ws, workspace: null,
      inlineAgents: ctx.inlineAgents,
      plannerAgentName: ctx.plannerName,
      round1Entries, roleOf: ctx.roleOf,
      maxParallel: ctx.maxParallel, repos: ctx.repos,
    });
    round2Entries = phaseResult.round2Entries;
    refixSkipReason = phaseResult.refixSkipReason;
  }

  const summary = await runSummaryPhase({
    storage: args.storage, taskId: args.taskRow.id,
    description: args.taskRow.description, cwd: ctx.cwd,
    team: ctx.team, inlineAgents: ctx.inlineAgents,
    plannerAgentName: ctx.plannerName,
    round1Entries, round2Entries,
    roleOf: ctx.roleOf, refixSkipReason, repos: ctx.repos,
  });
  return { status: summary.status };
}

async function runRefixStage(args: DispatchArgs): Promise<{ status: "completed" | "failed" }> {
  // All round 1 are completed; run refix-planning + round 2 + summarizer.
  const ctx = await loadStageContext(args.taskRow);
  const round1Entries = args.subTasks.filter((s) => s.round === 1).map((s) => entryFromRow(s));

  const phaseResult = await runRefixPhase({
    storage: args.storage, taskId: args.taskRow.id,
    description: args.taskRow.description, cwd: ctx.cwd,
    team: ctx.team, ws: ctx.ws, workspace: null,
    inlineAgents: ctx.inlineAgents,
    plannerAgentName: ctx.plannerName,
    round1Entries, roleOf: ctx.roleOf,
    maxParallel: ctx.maxParallel, repos: ctx.repos,
  });

  const summary = await runSummaryPhase({
    storage: args.storage, taskId: args.taskRow.id,
    description: args.taskRow.description, cwd: ctx.cwd,
    team: ctx.team, inlineAgents: ctx.inlineAgents,
    plannerAgentName: ctx.plannerName,
    round1Entries, round2Entries: phaseResult.round2Entries,
    roleOf: ctx.roleOf,
    refixSkipReason: phaseResult.refixSkipReason,
    repos: ctx.repos,
  });
  return { status: summary.status };
}

async function runSummarizerStage(args: DispatchArgs): Promise<{ status: "completed" | "failed" }> {
  const ctx = await loadStageContext(args.taskRow);
  const round1Entries = args.subTasks.filter((s) => s.round === 1).map((s) => entryFromRow(s));
  const round2Entries = args.subTasks.filter((s) => s.round === 2).map((s) => entryFromRow(s));
  const summary = await runSummaryPhase({
    storage: args.storage, taskId: args.taskRow.id,
    description: args.taskRow.description, cwd: ctx.cwd,
    team: ctx.team, inlineAgents: ctx.inlineAgents,
    plannerAgentName: ctx.plannerName,
    round1Entries, round2Entries,
    roleOf: ctx.roleOf,
    refixSkipReason: undefined,
    repos: ctx.repos,
  });
  return { status: summary.status };
}

async function runTriageStage(args: DispatchArgs): Promise<{ status: "completed" | "failed" }> {
  // Sub-tasks empty: re-run from triage. Body is essentially runTask minus the
  // initial insertTask + the leading PBI parse (already resolved before).
  const ctx = await loadStageContext(args.taskRow);
  args.storage.updateTaskStatus(args.taskRow.id, "planning");

  const triage = await runTriage({
    task: args.taskRow.description, cwd: ctx.cwd, team: ctx.team,
    plannerAgentName: ctx.plannerName,
    roster: ctx.workerInstances.map((i) => ({ name: i.name, role: i.role, description: i.description })),
    eventsPath: joinPath(taskDir(args.taskRow.id), "triage-events.jsonl"),
    inlineAgents: ctx.inlineAgents,
    ...(ctx.repos ? { repos: ctx.repos } : {}),
  });

  const selectedSet = new Set(triage.selectedAgents);
  const selected = ctx.workerInstances.filter((i) => selectedSet.has(i.name));
  if (selected.length === 0) throw new Error("triage selected no agents");

  const plan = await runPlanner({
    task: args.taskRow.description, cwd: ctx.cwd, team: ctx.team,
    plannerAgentName: ctx.plannerName,
    workers: selected.map((i) => ({ name: i.name, role: i.role, description: i.description })),
    difficulty: triage.difficulty,
    ...(triage.rationale ? { triageRationale: triage.rationale } : {}),
    eventsPath: joinPath(taskDir(args.taskRow.id), "planner-events.jsonl"),
    inlineAgents: ctx.inlineAgents,
    ...(ctx.repos ? { repos: ctx.repos } : {}),
  });

  const round1Entries = prepareRound({ storage: args.storage, taskId: args.taskRow.id, plan, round: 1 });
  args.storage.updateTaskStatus(args.taskRow.id, "running");

  await runRoundDag({
    entries: round1Entries,
    storage: args.storage, taskId: args.taskRow.id,
    ws: ctx.ws, cwd: ctx.cwd, team: ctx.team,
    inlineAgents: ctx.inlineAgents,
    originalTaskDescription: args.taskRow.description,
    maxParallel: ctx.maxParallel, workspace: null, round: 1,
  });

  const refix = await runRefixPhase({
    storage: args.storage, taskId: args.taskRow.id,
    description: args.taskRow.description, cwd: ctx.cwd,
    team: ctx.team, ws: ctx.ws, workspace: null,
    inlineAgents: ctx.inlineAgents, plannerAgentName: ctx.plannerName,
    round1Entries, roleOf: ctx.roleOf, maxParallel: ctx.maxParallel,
    repos: ctx.repos,
  });

  const summary = await runSummaryPhase({
    storage: args.storage, taskId: args.taskRow.id,
    description: args.taskRow.description, cwd: ctx.cwd,
    team: ctx.team, inlineAgents: ctx.inlineAgents,
    plannerAgentName: ctx.plannerName,
    round1Entries, round2Entries: refix.round2Entries,
    roleOf: ctx.roleOf, refixSkipReason: refix.refixSkipReason,
    repos: ctx.repos,
  });
  return { status: summary.status };
}

function entryFromRow(s: SubTaskRow): SubTaskEntry {
  return {
    id: s.id, index: 0,
    plan: {
      id: s.id, title: s.title, prompt: s.prompt,
      assignedAgent: s.assigned_agent,
      ...(s.target_repo ? { targetRepo: s.target_repo } : {}),
      dependsOn: s.depends_on ? (JSON.parse(s.depends_on) as string[]) : [],
    },
  };
}
