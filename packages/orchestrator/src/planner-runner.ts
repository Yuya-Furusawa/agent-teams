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
  type TaskPlan,
  type Triage,
} from "./planner-schema.js";
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
}): Promise<Triage> {
  const prompt = buildTriagePrompt({
    task: opts.task,
    cwd: opts.cwd,
    roster: opts.roster,
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
}): Promise<TaskPlan> {
  const prompt = buildPlannerPrompt({
    task: opts.task,
    cwd: opts.cwd,
    workerRoster: opts.workers,
    difficulty: opts.difficulty,
    triageRationale: opts.triageRationale,
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
  }>;
  eventsPath?: string;
  inlineAgents?: Record<string, InlineAgentDefinition>;
  onEvent?: (event: StreamJsonEvent) => void;
}): Promise<{ summary: string; status: string }> {
  const prompt = buildSummaryPrompt({
    task: opts.task,
    cwd: opts.cwd,
    subTaskReports: opts.subTaskReports,
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
