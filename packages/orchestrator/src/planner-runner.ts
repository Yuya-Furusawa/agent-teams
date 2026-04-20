import { AgentRunner, type InlineAgentDefinition, type StreamJsonEvent } from "@agent-teams/agent-runner";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  TaskPlanSchema,
  TriageSchema,
  buildPlannerPrompt,
  buildSummaryPrompt,
  buildTriagePrompt,
  type Difficulty,
  type RepoInfo,
  type TaskPlan,
  type Triage,
} from "./planner-schema.js";

export function validatePlanDag(plan: TaskPlan): void {
  const ids = new Set<string>();
  for (const sub of plan.subTasks) {
    if (ids.has(sub.id)) {
      throw new Error(`planner produced duplicate sub-task id "${sub.id}"`);
    }
    ids.add(sub.id);
  }
  for (const sub of plan.subTasks) {
    for (const dep of sub.dependsOn ?? []) {
      if (!ids.has(dep)) {
        throw new Error(
          `sub-task "${sub.id}" depends on unknown id "${dep}"`,
        );
      }
      if (dep === sub.id) {
        throw new Error(`sub-task "${sub.id}" depends on itself`);
      }
    }
  }
  // Kahn-style cycle detection
  const remaining = new Map<string, Set<string>>();
  for (const sub of plan.subTasks) {
    remaining.set(sub.id, new Set(sub.dependsOn ?? []));
  }
  const ready: string[] = [];
  for (const [id, deps] of remaining) if (deps.size === 0) ready.push(id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift()!;
    visited++;
    for (const [other, deps] of remaining) {
      if (deps.delete(id) && deps.size === 0) ready.push(other);
    }
  }
  if (visited !== plan.subTasks.length) {
    const stuck = [...remaining.entries()]
      .filter(([, d]) => d.size > 0)
      .map(([id]) => id);
    throw new Error(`plan has a dependency cycle involving: ${stuck.join(", ")}`);
  }
}
import type { Team } from "./team.js";

function eventLogger(path: string): (event: StreamJsonEvent) => void {
  mkdirSync(dirname(path), { recursive: true });
  return (event: StreamJsonEvent) => {
    try {
      appendFileSync(path, JSON.stringify(event) + "\n", "utf8");
    } catch {
      // best-effort logging
    }
  };
}

export async function runTriage(opts: {
  task: string;
  cwd: string;
  team: Team;
  plannerAgentName: string;
  roster: Array<{ name: string; role?: string; description?: string }>;
  eventsPath?: string;
  inlineAgents?: Record<string, InlineAgentDefinition>;
  onEvent?: (event: StreamJsonEvent) => void;
  repos?: RepoInfo[];
}): Promise<Triage> {
  const prompt = buildTriagePrompt({
    task: opts.task,
    cwd: opts.cwd,
    roster: opts.roster,
    ...(opts.repos ? { repos: opts.repos } : {}),
  });

  const fileLogger = opts.eventsPath ? eventLogger(opts.eventsPath) : undefined;

  const runner = new AgentRunner();
  const result = await runner.run({
    agent: opts.plannerAgentName,
    prompt,
    cwd: opts.cwd,
    includeHookEvents: false,
    permissionMode: "bypassPermissions",
    model: opts.team.defaults?.model,
    inlineAgents: opts.inlineAgents,
    onEvent: (event) => {
      fileLogger?.(event);
      opts.onEvent?.(event);
    },
  });

  if (result.exitCode !== 0) {
    throw new Error(`triage exited with code ${result.exitCode}`);
  }
  if (!result.parsedJson) {
    throw new Error(
      `triage did not produce a parseable JSON block.${opts.eventsPath ? ` raw events: ${opts.eventsPath}` : ""} last text excerpt: ${result.lastText.slice(0, 500)}`,
    );
  }
  const triage = TriageSchema.parse(result.parsedJson);
  const rosterNames = new Set(opts.roster.map((w) => w.name));
  const unknown = triage.selectedAgents.filter((n) => !rosterNames.has(n));
  if (unknown.length > 0) {
    throw new Error(
      `triage selected agents not in roster: ${unknown.join(", ")}. roster: ${[...rosterNames].join(", ")}`,
    );
  }
  return triage;
}

export async function runPlanner(opts: {
  task: string;
  cwd: string;
  team: Team;
  plannerAgentName: string;
  workers: Array<{ name: string; role?: string; description?: string }>;
  difficulty?: Difficulty;
  triageRationale?: string;
  eventsPath?: string;
  inlineAgents?: Record<string, InlineAgentDefinition>;
  onEvent?: (event: StreamJsonEvent) => void;
  repos?: RepoInfo[];
}): Promise<TaskPlan> {
  const prompt = buildPlannerPrompt({
    task: opts.task,
    cwd: opts.cwd,
    workerRoster: opts.workers,
    ...(opts.difficulty ? { difficulty: opts.difficulty } : {}),
    ...(opts.triageRationale ? { triageRationale: opts.triageRationale } : {}),
    ...(opts.repos ? { repos: opts.repos } : {}),
  });

  const fileLogger = opts.eventsPath ? eventLogger(opts.eventsPath) : undefined;

  const runner = new AgentRunner();
  const result = await runner.run({
    agent: opts.plannerAgentName,
    prompt,
    cwd: opts.cwd,
    includeHookEvents: false,
    permissionMode: "bypassPermissions",
    model: opts.team.defaults?.model,
    inlineAgents: opts.inlineAgents,
    onEvent: (event) => {
      fileLogger?.(event);
      opts.onEvent?.(event);
    },
  });

  if (result.exitCode !== 0) {
    throw new Error(`planner exited with code ${result.exitCode}`);
  }
  if (!result.parsedJson) {
    throw new Error(
      `planner did not produce a parseable JSON block.${opts.eventsPath ? ` raw events: ${opts.eventsPath}` : ""} last text excerpt: ${result.lastText.slice(0, 500)}`,
    );
  }
  const parsed = TaskPlanSchema.parse(result.parsedJson);

  const allowed = new Set(opts.workers.map((w) => w.name));
  for (const sub of parsed.subTasks) {
    if (!allowed.has(sub.assignedAgent)) {
      throw new Error(
        `planner assigned agent "${sub.assignedAgent}" which is not in the roster: ${[...allowed].join(", ")}`,
      );
    }
  }

  validatePlanDag(parsed);

  if (opts.repos && opts.repos.length > 0) {
    const repoNames = new Set(opts.repos.map((r) => r.name));
    for (const sub of parsed.subTasks) {
      if (!sub.targetRepo) {
        throw new Error(
          `workspace mode: planner omitted targetRepo for sub-task "${sub.title}". Expected one of: ${[...repoNames].join(", ")}`,
        );
      }
      if (!repoNames.has(sub.targetRepo)) {
        throw new Error(
          `workspace mode: planner assigned unknown targetRepo "${sub.targetRepo}" for sub-task "${sub.title}". Expected one of: ${[...repoNames].join(", ")}`,
        );
      }
    }
  }
  return parsed;
}

export async function runSummarizer(opts: {
  task: string;
  cwd: string;
  team: Team;
  plannerAgentName: string;
  subTaskReports: Array<{
    title: string;
    agent: string;
    role?: string;
    status: string;
    report: string;
    targetRepo?: string | null;
  }>;
  eventsPath?: string;
  inlineAgents?: Record<string, InlineAgentDefinition>;
  onEvent?: (event: StreamJsonEvent) => void;
  repos?: RepoInfo[];
}): Promise<{ summary: string; status: string }> {
  const prompt = buildSummaryPrompt({
    task: opts.task,
    cwd: opts.cwd,
    subTaskReports: opts.subTaskReports,
    ...(opts.repos ? { repos: opts.repos } : {}),
  });

  const fileLogger = opts.eventsPath ? eventLogger(opts.eventsPath) : undefined;

  const runner = new AgentRunner();
  const result = await runner.run({
    agent: opts.plannerAgentName,
    prompt,
    cwd: opts.cwd,
    includeHookEvents: false,
    permissionMode: "bypassPermissions",
    model: opts.team.defaults?.model,
    inlineAgents: opts.inlineAgents,
    onEvent: (event) => {
      fileLogger?.(event);
      opts.onEvent?.(event);
    },
  });

  if (result.exitCode !== 0) {
    throw new Error(`summarizer exited with code ${result.exitCode}`);
  }
  const parsed = (result.parsedJson ?? {
    summary: result.lastText || "(summarizer produced no text)",
    status: "partial",
  }) as { summary: string; status?: string };
  return { summary: parsed.summary, status: parsed.status ?? "partial" };
}
