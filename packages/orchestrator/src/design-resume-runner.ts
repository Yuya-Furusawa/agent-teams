import { hostname } from "node:os";
import { ulid } from "ulid";
import {
  Storage,
  initAgentDir,
  summaryFile,
  type DesignState,
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
import { loadTeam, type Team } from "./team.js";
import { loadWorkspace, type Workspace } from "./workspace.js";
import {
  DesignCheckpointReached,
  runRefixPhase,
  runRoundDag,
  runSummaryPhase,
  type SubTaskEntry,
} from "./orchestrator.js";

const STALE_LOCK_MS = 30 * 60 * 1000;

export interface ResumeDesignOptions {
  taskId: string;
  approve?: boolean;
  feedback?: string;
}

export interface ResumeDesignResult {
  taskId: string;
  status: "completed" | "failed" | "awaiting_user_input";
  iteration: number;
  summaryPath: string;
}

interface DesignContext {
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

function loadDesignContext(task: TaskRow): DesignContext {
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

function entryFromRow(s: SubTaskRow): SubTaskEntry {
  return {
    id: s.id,
    index: 0,
    plan: {
      id: s.id,
      title: s.title,
      prompt: s.prompt,
      assignedAgent: s.assigned_agent,
      ...(s.target_repo ? { targetRepo: s.target_repo } : {}),
      dependsOn: s.depends_on ? (JSON.parse(s.depends_on) as string[]) : [],
    },
  };
}

export async function resumeDesignTask(opts: ResumeDesignOptions): Promise<ResumeDesignResult> {
  if (!opts.approve && !opts.feedback) {
    throw new Error("design-resume requires either --approve or --feedback");
  }
  if (opts.approve && opts.feedback) {
    throw new Error("design-resume: --approve and --feedback are mutually exclusive");
  }
  if (opts.feedback !== undefined && opts.feedback.trim() === "") {
    throw new Error("design-resume: --feedback text is required (got empty string)");
  }

  const storage = new Storage();
  try {
    const taskRow = storage.getTask(opts.taskId);
    if (!taskRow) throw new Error(`task ${opts.taskId} not found`);
    if (taskRow.status !== "awaiting_user_input") {
      throw new Error(
        `task ${opts.taskId} is not awaiting design approval (status=${taskRow.status})`,
      );
    }
    const designState = storage.readDesignState(opts.taskId);
    if (!designState) throw new Error(`task ${opts.taskId} has no design state`);

    const lock: ResumeLock = { pid: process.pid, host: hostname(), started_at: Date.now() };
    if (!storage.acquireResumeLock(opts.taskId, lock, STALE_LOCK_MS)) {
      const held = storage.readResumeLock(opts.taskId);
      throw new Error(
        `task ${opts.taskId} is locked by another process (pid=${held?.pid}, host=${held?.host}, ` +
        `started_at=${held?.started_at}). Wait or pass --force.`,
      );
    }

    try {
      if (opts.approve) {
        return await approveAndContinue(storage, taskRow, designState);
      }
      return await respawnHanaWithFeedback(storage, taskRow, designState, opts.feedback!);
    } finally {
      storage.releaseResumeLock(opts.taskId, process.pid);
    }
  } finally {
    storage.close();
  }
}

async function approveAndContinue(
  storage: Storage,
  taskRow: TaskRow,
  designState: DesignState,
): Promise<ResumeDesignResult> {
  designState.phase = "approved";
  storage.updateDesignState(taskRow.id, designState);
  storage.updateTaskStatus(taskRow.id, "running");
  const ctx = loadDesignContext(taskRow);
  return continueAfterApproval(storage, taskRow, designState, ctx);
}

async function respawnHanaWithFeedback(
  storage: Storage,
  taskRow: TaskRow,
  designState: DesignState,
  feedback: string,
): Promise<ResumeDesignResult> {
  const oldSub = storage.getSubTask(designState.designer_sub_task_id);
  if (!oldSub) {
    throw new Error(`designer sub-task ${designState.designer_sub_task_id} missing`);
  }

  const newId = ulid();
  const newIteration = designState.iteration + 1;
  if (newIteration > 10) {
    process.stderr.write(
      `warning: design iteration count exceeds 10 for task ${taskRow.id}. ` +
      `consider --approve to proceed with the current design.\n`,
    );
  }

  const newPrompt =
    `${oldSub.prompt}\n\n## User feedback (iteration ${newIteration})\n${feedback}`;

  storage.insertSubTask({
    id: newId,
    task_id: taskRow.id,
    title: oldSub.title,
    prompt: newPrompt,
    assigned_agent: "Hana",
    status: "pending",
    created_at: Date.now(),
    target_repo: oldSub.target_repo,
    depends_on: null, // Hana remains the sole layer-0 node
    round: 1,
  });

  // Re-point downstream sub-tasks (everything that depended on the previous
  // Hana ULID) to the new ULID so runRoundDag's dependency check unblocks
  // them after the new Hana finishes.
  storage.swapDependency(taskRow.id, designState.designer_sub_task_id, newId);

  // Update design_state pointer ahead of the run. completed_sub_task_ids is
  // NOT mutated here per spec; it gets the new ULID only after the run
  // outcome is known (checkpoint OR skip).
  designState.designer_sub_task_id = newId;
  designState.iteration = newIteration;
  storage.updateDesignState(taskRow.id, designState);
  storage.updateTaskStatus(taskRow.id, "running");

  initAgentDir(taskRow.id, newId);

  const ctx = loadDesignContext(taskRow);
  const newEntry: SubTaskEntry = {
    id: newId,
    index: 0,
    plan: {
      id: newId,
      title: oldSub.title,
      prompt: newPrompt,
      assignedAgent: "Hana",
      ...(oldSub.target_repo ? { targetRepo: oldSub.target_repo } : {}),
      dependsOn: [],
    },
  };

  try {
    await runRoundDag({
      entries: [newEntry],
      storage,
      taskId: taskRow.id,
      ws: ctx.ws,
      cwd: ctx.cwd,
      team: ctx.team,
      inlineAgents: ctx.inlineAgents,
      originalTaskDescription: taskRow.description,
      maxParallel: ctx.maxParallel,
      workspace: null,
      round: 1,
    });
    // No DesignCheckpointReached thrown means Hana decided modified_files:[]
    // (no design change needed for this iteration). Treat as approved and
    // continue the rest of the DAG (impl + reviewers + refix + summary).
    designState.phase = "approved";
    designState.completed_sub_task_ids.push(newId);
    storage.updateDesignState(taskRow.id, designState);
    return await continueAfterApproval(storage, taskRow, designState, ctx);
  } catch (err) {
    if (err instanceof DesignCheckpointReached) {
      designState.last_checkpoint = {
        modified_files: err.checkpoint.modified_files,
        summary: err.checkpoint.summary,
        preview_images: err.checkpoint.preview_images,
      };
      designState.completed_sub_task_ids.push(newId);
      storage.updateDesignState(taskRow.id, designState);
      storage.updateTaskStatus(taskRow.id, "awaiting_user_input");
      process.stdout.write(`STATUS: awaiting_design_approval\n`);
      process.stdout.write(`TASK_ID: ${taskRow.id}\n`);
      process.stdout.write(`ITERATION: ${newIteration}\n`);
      process.stdout.write("```json\n" + JSON.stringify(err.checkpoint, null, 2) + "\n```\n");
      return {
        taskId: taskRow.id,
        status: "awaiting_user_input",
        iteration: newIteration,
        summaryPath: "",
      };
    }
    storage.updateTaskStatus(taskRow.id, "failed", Date.now());
    throw err;
  }
}

async function continueAfterApproval(
  storage: Storage,
  taskRow: TaskRow,
  designState: DesignState,
  ctx: DesignContext,
): Promise<ResumeDesignResult> {
  const allSubTasks = storage.listSubTasks(taskRow.id);
  const preCompletedIds = new Set(designState.completed_sub_task_ids);
  // runRoundDag dispatches every node in `entries`; preCompletedIds only
  // satisfies dependency edges. So we feed it the not-yet-completed work
  // and pass preCompletedIds so dependents on Hana unblock immediately.
  const round1Pending = allSubTasks
    .filter((s) => s.round === 1 && !preCompletedIds.has(s.id))
    .map(entryFromRow);

  await runRoundDag({
    entries: round1Pending,
    storage,
    taskId: taskRow.id,
    ws: ctx.ws,
    cwd: ctx.cwd,
    team: ctx.team,
    inlineAgents: ctx.inlineAgents,
    originalTaskDescription: taskRow.description,
    maxParallel: ctx.maxParallel,
    workspace: null,
    round: 1,
    preCompletedIds,
  });

  const refresh = storage.listSubTasks(taskRow.id);
  const refreshedRound1 = refresh.filter((s) => s.round === 1).map(entryFromRow);

  const refix = await runRefixPhase({
    storage,
    taskId: taskRow.id,
    description: taskRow.description,
    cwd: ctx.cwd,
    team: ctx.team,
    ws: ctx.ws,
    workspace: null,
    inlineAgents: ctx.inlineAgents,
    plannerAgentName: ctx.plannerName,
    round1Entries: refreshedRound1,
    roleOf: ctx.roleOf,
    maxParallel: ctx.maxParallel,
    repos: ctx.repos,
  });

  const summary = await runSummaryPhase({
    storage,
    taskId: taskRow.id,
    description: taskRow.description,
    cwd: ctx.cwd,
    team: ctx.team,
    inlineAgents: ctx.inlineAgents,
    plannerAgentName: ctx.plannerName,
    round1Entries: refreshedRound1,
    round2Entries: refix.round2Entries,
    roleOf: ctx.roleOf,
    refixSkipReason: refix.refixSkipReason,
    repos: ctx.repos,
  });

  storage.updateTaskStatus(taskRow.id, summary.status, Date.now());

  return {
    taskId: taskRow.id,
    status: summary.status,
    iteration: designState.iteration,
    summaryPath: summaryFile(taskRow.id),
  };
}
