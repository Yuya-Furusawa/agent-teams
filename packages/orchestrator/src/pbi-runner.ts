import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import {
  initTaskDir,
  initAgentDir,
  taskDir,
  writeTaskSnapshot,
  readReport,
  Storage,
} from "@agent-teams/storage";
import {
  currentWorkspace,
  log as cmuxLog,
  setStatus,
  clearStatus,
  type WorkspaceRef,
} from "@agent-teams/cmux-adapter";
import { loadAgentRegistry, type AgentRegistry } from "./agent-registry.js";
import { buildInstanceInlineAgents, type AgentInstance } from "./instance.js";
import { runWorker } from "./worker-runner.js";
import { runPbiPlanner, runPbiAssembly } from "./planner-runner.js";
import { parseInterviewReport } from "./checkpoint-parse.js";
import { runRoundDag, prepareRound, truncate, type SubTaskEntry } from "./orchestrator.js";
import { loadPbiConfig } from "./pbi-config.js";
import { nextPbiNumber } from "./pbi-numbering.js";
import { formatPbiFilename } from "./pbi-filename.js";
import { extractSlug } from "./pbi-frontmatter.js";
import type { PbiConfig, Team } from "./team.js";
import type { SubTaskPlan } from "./planner-schema.js";
import { loadWorkspace } from "./workspace.js";

const FIXED_PBI_AGENTS = ["Pax", "Quinn", "Aki"] as const;
const PLANNER_NAME = "Sage";
const PBI_TEAM: Team = {
  name: "(pbi-mode)",
  planner: PLANNER_NAME,
  workers: [...FIXED_PBI_AGENTS],
};

export interface RunPbiTaskOptions {
  idea: string;
  cwd?: string;
  workspace?: string;
}

export interface PbiQuestionsOutput {
  kind: "questions";
  taskId: string;
  pbiId: number;
  questions: Array<{ id: string; question: string }>;
}

export interface PbiCompletedOutput {
  kind: "completed";
  taskId: string;
  pbiId: number;
  pbiPath: string;
}

export type RunPbiTaskResult = PbiQuestionsOutput | PbiCompletedOutput;

interface SerializedEntry {
  id: string;
  plan: SubTaskPlan;
}

interface PbiState {
  phase: "planning" | "interviewing" | "awaiting_user_input" | "drafting" | "completed";
  pbi_id: number;
  vault: string;
  dir: string;
  idea: string;
  pending_questions?: Array<{ id: string; question: string }>;
  entries?: SerializedEntry[];
  output_path?: string;
}

function buildPbiInlineAgents(registry: AgentRegistry): Record<string, { description: string; prompt: string }> {
  const instances: AgentInstance[] = [];
  for (const name of [...FIXED_PBI_AGENTS, PLANNER_NAME]) {
    const def = registry[name];
    if (!def) {
      throw new Error(
        `required PBI agent "${name}" not found in registry. Make sure agents/${name}.md exists.`,
      );
    }
    instances.push({
      name: def.name,
      role: def.role,
      personality: def.personality,
      description: def.description,
      prompt: def.prompt,
      isBuiltIn: false,
    });
  }
  return buildInstanceInlineAgents(instances);
}

export async function runPbiTask(opts: RunPbiTaskOptions): Promise<RunPbiTaskResult> {
  if (opts.workspace && opts.cwd) {
    throw new Error("--workspace cannot be combined with --cwd");
  }
  const registry = loadAgentRegistry();
  const inlineAgents = buildPbiInlineAgents(registry);
  let cwd: string;
  let pbiCfg: PbiConfig;
  if (opts.workspace) {
    const ws = loadWorkspace(opts.workspace);
    cwd = ws.repos[0]!.path;
    pbiCfg = loadPbiConfig({ workspace: ws });
  } else {
    cwd = opts.cwd ?? process.cwd();
    pbiCfg = loadPbiConfig({ cwd });
  }
  if (!existsSync(join(pbiCfg.vault, pbiCfg.dir))) {
    throw new Error(
      `PBI directory does not exist: ${join(pbiCfg.vault, pbiCfg.dir)}. Create it first or fix pbi.vault/dir.`,
    );
  }

  const pbiId = nextPbiNumber(pbiCfg);
  const taskId = ulid();
  initTaskDir(taskId);

  const storage = new Storage();
  const state: PbiState = {
    phase: "planning",
    pbi_id: pbiId,
    vault: pbiCfg.vault,
    dir: pbiCfg.dir,
    idea: opts.idea,
  };
  storage.insertTask({
    id: taskId,
    description: `[PBI-${String(pbiId).padStart(3, "0")}] ${truncate(opts.idea, 120)}`,
    cwd,
    team_name: PBI_TEAM.name,
    status: "planning",
    created_at: Date.now(),
    pbi_state: state as unknown as Record<string, unknown>,
  });

  const workspace = await currentWorkspace().catch(() => null);
  if (workspace) {
    await setStatus({ workspace, key: "agent-teams", value: `PBI-${pbiId} planning…`, icon: "doc.text" });
  }

  const plan = await runPbiPlanner({
    idea: opts.idea,
    pbiId,
    cwd,
    team: PBI_TEAM,
    plannerAgentName: PLANNER_NAME,
    inlineAgents,
    eventsPath: join(taskDir(taskId), "pbi-planner-events.jsonl"),
  });

  const entries = prepareRound({ storage, taskId, plan, round: 1 });
  state.entries = entries.map((e) => ({ id: e.id, plan: e.plan }));
  storage.updatePbiState(taskId, state as unknown as Record<string, unknown>);

  writeTaskSnapshot({
    id: taskId,
    description: opts.idea,
    cwd,
    team: PBI_TEAM.name,
    status: "running",
    subTasks: entries.map((e) => ({
      id: e.id,
      title: e.plan.title,
      assignedAgent: e.plan.assignedAgent,
      status: "pending",
      targetRepo: null,
      dependsOn: [],
      round: 1,
    })),
    createdAt: Date.now(),
    completedAt: null,
  });
  storage.updateTaskStatus(taskId, "running");

  const interviewEntry = entries.find((e) => e.plan.id === "pax-interview");
  if (!interviewEntry) {
    throw new Error(`pbi-planner did not include 'pax-interview' sub-task`);
  }

  state.phase = "interviewing";
  storage.updatePbiState(taskId, state as unknown as Record<string, unknown>);
  if (workspace) {
    await setStatus({ workspace, key: "agent-teams", value: `PBI-${pbiId} pax-interview…`, icon: "questionmark.circle" });
  }

  initAgentDir(taskId, interviewEntry.id);
  storage.updateSubTaskStatus(interviewEntry.id, "running");
  try {
    await runWorker({
      taskId,
      subTaskId: interviewEntry.id,
      agent: interviewEntry.plan.assignedAgent,
      originalTask: opts.idea,
      subTaskTitle: interviewEntry.plan.title,
      subTaskPrompt: interviewEntry.plan.prompt,
      cwd,
      inlineAgents,
    });
    storage.updateSubTaskStatus(interviewEntry.id, "completed", Date.now());
  } catch (err) {
    storage.updateSubTaskStatus(interviewEntry.id, "failed", Date.now());
    throw err;
  }

  const interviewReport = readReport(taskId, interviewEntry.id) ?? "";
  const judged = parseInterviewReport(interviewReport);

  if (judged.kind === "questions") {
    state.phase = "awaiting_user_input";
    state.pending_questions = judged.questions;
    storage.updatePbiState(taskId, state as unknown as Record<string, unknown>);
    storage.updateTaskStatus(taskId, "awaiting_user_input");
    if (workspace) {
      await cmuxLog({
        workspace,
        source: "agent-teams",
        message: `PBI-${pbiId} awaiting user input (${judged.questions.length} questions)`,
      });
      await clearStatus({ workspace, key: "agent-teams" });
    }
    return { kind: "questions", taskId, pbiId, questions: judged.questions };
  }

  return await continuePbiPipeline({
    storage,
    taskId,
    pbiId,
    pbiCfg,
    cwd,
    idea: opts.idea,
    inlineAgents,
    entries,
    workspace,
    userAnswers: null,
    state,
  });
}

interface ContinueArgs {
  storage: Storage;
  taskId: string;
  pbiId: number;
  pbiCfg: PbiConfig;
  cwd: string;
  idea: string;
  inlineAgents: Record<string, { description: string; prompt: string }>;
  entries: SubTaskEntry[];
  workspace: WorkspaceRef | null;
  userAnswers: Record<string, string> | null;
  state: PbiState;
}

async function continuePbiPipeline(args: ContinueArgs): Promise<PbiCompletedOutput> {
  const { storage, taskId, pbiId, pbiCfg, cwd, idea, inlineAgents, entries, workspace, userAnswers, state } = args;

  const remaining = entries.filter((e) => e.plan.id !== "pax-interview");
  const draftEntry = remaining.find((e) => e.plan.id === "pax-draft");
  if (!draftEntry) throw new Error(`plan missing 'pax-draft' sub-task`);

  if (userAnswers && Object.keys(userAnswers).length > 0) {
    const answersBlock = Object.entries(userAnswers)
      .map(([id, answer]) => `- **${id}**: ${answer}`)
      .join("\n");
    (draftEntry.plan as { prompt: string }).prompt =
      `${draftEntry.plan.prompt}\n\n## User-provided answers\n${answersBlock}`;
  }

  state.phase = "drafting";
  storage.updatePbiState(taskId, state as unknown as Record<string, unknown>);
  storage.updateTaskStatus(taskId, "running");
  if (workspace) {
    await setStatus({ workspace, key: "agent-teams", value: `PBI-${pbiId} drafting…`, icon: "pencil" });
  }

  await runRoundDag({
    entries: remaining,
    storage,
    taskId,
    ws: undefined,
    cwd,
    team: PBI_TEAM,
    inlineAgents,
    originalTaskDescription: idea,
    maxParallel: 3,
    workspace,
    round: 1,
  });

  if (workspace) {
    await setStatus({ workspace, key: "agent-teams", value: `PBI-${pbiId} assembling…`, icon: "doc.append" });
  }

  const reportFor = (planId: string): { status: string; content: string } => {
    const e = remaining.find((x) => x.plan.id === planId);
    if (!e) return { status: "missing", content: "" };
    return { status: storage.getSubTaskStatus(e.id), content: readReport(taskId, e.id) ?? "" };
  };

  const assembly = await runPbiAssembly({
    idea,
    pbiId,
    cwd,
    team: PBI_TEAM,
    plannerAgentName: PLANNER_NAME,
    inlineAgents,
    reports: {
      pax: reportFor("pax-draft"),
      quinn: reportFor("quinn"),
      aki: reportFor("aki"),
    },
    eventsPath: join(taskDir(taskId), "pbi-assembly-events.jsonl"),
  });

  const slug = extractSlug(assembly.markdown);
  if (!slug) {
    throw new Error(
      `pbi-assembly: failed to extract slug from frontmatter. Check Sage's output (events at ${taskDir(taskId)}/pbi-assembly-events.jsonl).`,
    );
  }
  const filename = formatPbiFilename(pbiId, slug);
  const targetDir = join(pbiCfg.vault, pbiCfg.dir);
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, filename);
  if (existsSync(targetPath)) {
    throw new Error(`PBI file already exists: ${targetPath} (concurrent /pbi run?)`);
  }
  writeFileSync(targetPath, assembly.markdown, "utf8");

  state.phase = "completed";
  state.output_path = targetPath;
  delete state.pending_questions;
  storage.updatePbiState(taskId, state as unknown as Record<string, unknown>);
  storage.updateTaskStatus(taskId, "completed", Date.now());
  if (workspace) {
    await cmuxLog({
      workspace,
      source: "agent-teams",
      message: `PBI-${pbiId} written to ${targetPath}`,
    });
    await clearStatus({ workspace, key: "agent-teams" });
  }
  return { kind: "completed", taskId, pbiId, pbiPath: targetPath };
}

export async function resumePbiTask(opts: {
  taskId: string;
  answers: Record<string, string>;
}): Promise<PbiCompletedOutput> {
  const storage = new Storage();
  const task = storage.getTask(opts.taskId);
  if (!task) throw new Error(`task not found: ${opts.taskId}`);
  const state = task.pbi_state as PbiState | null;
  if (!state || state.phase !== "awaiting_user_input") {
    throw new Error(
      `task ${opts.taskId} is not awaiting user input (phase: ${state?.phase ?? "none"})`,
    );
  }
  const pending = state.pending_questions ?? [];
  const expectedIds = new Set(pending.map((q) => q.id));
  const givenIds = new Set(Object.keys(opts.answers));
  for (const id of expectedIds) {
    if (!givenIds.has(id)) throw new Error(`missing answer for question id "${id}"`);
  }
  for (const id of givenIds) {
    if (!expectedIds.has(id)) {
      throw new Error(
        `unexpected answer key "${id}" — pending question ids: ${[...expectedIds].join(", ")}`,
      );
    }
  }
  if (!state.entries || state.entries.length === 0) {
    throw new Error(`task ${opts.taskId} has no saved entries to resume from`);
  }

  const registry = loadAgentRegistry();
  const inlineAgents = buildPbiInlineAgents(registry);
  const entries: SubTaskEntry[] = state.entries.map((e, idx) => ({
    id: e.id,
    index: idx,
    plan: e.plan,
  }));

  const workspace = await currentWorkspace().catch(() => null);
  return await continuePbiPipeline({
    storage,
    taskId: opts.taskId,
    pbiId: state.pbi_id,
    pbiCfg: { vault: state.vault, dir: state.dir },
    cwd: task.cwd,
    idea: state.idea,
    inlineAgents,
    entries,
    workspace,
    userAnswers: opts.answers,
    state,
  });
}
