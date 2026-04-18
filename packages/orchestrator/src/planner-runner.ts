import { AgentRunner, type StreamJsonEvent } from "@agent-teams/agent-runner";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  TaskPlanSchema,
  buildPlannerPrompt,
  buildSummaryPrompt,
  type TaskPlan,
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

export async function runPlanner(opts: {
  task: string;
  cwd: string;
  team: Team;
  eventsPath?: string;
  onEvent?: (event: StreamJsonEvent) => void;
}): Promise<TaskPlan> {
  const prompt = buildPlannerPrompt({
    task: opts.task,
    cwd: opts.cwd,
    workerRoster: opts.team.workers.map((name) => ({ name })),
  });

  const fileLogger = opts.eventsPath ? eventLogger(opts.eventsPath) : undefined;

  const runner = new AgentRunner();
  const result = await runner.run({
    agent: opts.team.planner,
    prompt,
    cwd: opts.cwd,
    includeHookEvents: false,
    permissionMode: "bypassPermissions",
    model: opts.team.defaults?.model,
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

  for (const sub of parsed.subTasks) {
    if (!opts.team.workers.includes(sub.assignedAgent)) {
      throw new Error(
        `planner assigned agent "${sub.assignedAgent}" which is not in the roster: ${opts.team.workers.join(", ")}`,
      );
    }
  }
  return parsed;
}

export async function runSummarizer(opts: {
  task: string;
  cwd: string;
  team: Team;
  subTaskReports: Array<{ title: string; agent: string; status: string; report: string }>;
  eventsPath?: string;
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
    agent: opts.team.planner,
    prompt,
    cwd: opts.cwd,
    includeHookEvents: false,
    permissionMode: "bypassPermissions",
    model: opts.team.defaults?.model,
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
