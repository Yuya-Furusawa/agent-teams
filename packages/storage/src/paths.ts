import { homedir } from "node:os";
import { join } from "node:path";

export function getHome(): string {
  return process.env["AGENT_TEAMS_HOME"] ?? join(homedir(), ".agent-teams");
}

export function dbPath(): string {
  return process.env["AGENT_TEAMS_DB"] ?? join(getHome(), "db.sqlite");
}

export function taskDir(taskId: string): string {
  return join(getHome(), "tasks", taskId);
}

export function taskFile(taskId: string): string {
  return join(taskDir(taskId), "task.json");
}

export function summaryFile(taskId: string): string {
  return join(taskDir(taskId), "summary.md");
}

export function agentDir(taskId: string, subTaskId: string): string {
  return join(taskDir(taskId), "agents", subTaskId);
}

export function reportFile(taskId: string, subTaskId: string): string {
  return join(agentDir(taskId, subTaskId), "report.md");
}

export function eventsFile(taskId: string, subTaskId: string): string {
  return join(agentDir(taskId, subTaskId), "events.jsonl");
}

export function settingsFile(taskId: string, subTaskId: string): string {
  return join(agentDir(taskId, subTaskId), "settings.json");
}
