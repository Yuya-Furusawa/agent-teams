import { appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import {
  agentDir,
  eventsFile,
  reportFile,
  summaryFile,
  taskDir,
  taskFile,
} from "./paths.js";

export interface TaskSnapshot {
  id: string;
  description: string;
  cwd: string;
  team: string;
  status: string;
  workspace?: string | null;
  repos?: Array<{ name: string; path: string; role?: string }> | null;
  subTasks: Array<{
    id: string;
    title: string;
    assignedAgent: string;
    status: string;
    targetRepo?: string | null;
    dependsOn?: string[];
    round?: number;
  }>;
  createdAt: number;
  completedAt: number | null;
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function initTaskDir(taskId: string): void {
  mkdirSync(taskDir(taskId), { recursive: true });
}

export function initAgentDir(taskId: string, subTaskId: string): void {
  mkdirSync(agentDir(taskId, subTaskId), { recursive: true });
}

export function writeTaskSnapshot(snapshot: TaskSnapshot): void {
  const path = taskFile(snapshot.id);
  ensureDir(path);
  writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf8");
}

export function appendEvent(
  taskId: string,
  subTaskId: string,
  event: unknown,
): void {
  const path = eventsFile(taskId, subTaskId);
  ensureDir(path);
  appendFileSync(path, JSON.stringify(event) + "\n", "utf8");
}

export function writeReport(
  taskId: string,
  subTaskId: string,
  content: string,
): void {
  const path = reportFile(taskId, subTaskId);
  ensureDir(path);
  writeFileSync(path, content, "utf8");
}

export function readReport(
  taskId: string,
  subTaskId: string,
): string | null {
  const path = reportFile(taskId, subTaskId);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function writeSummary(taskId: string, content: string): void {
  const path = summaryFile(taskId);
  ensureDir(path);
  writeFileSync(path, content, "utf8");
}

/**
 * Rename `path` to `<path>.backup-<unix-ms>` and prune older backups so that at
 * most `keep` survive. Returns the new backup path, or null if the source file
 * does not exist (treated as a no-op).
 */
export function rotateBackup(path: string, keep: number): string | null {
  if (!existsSync(path)) return null;
  const ts = Date.now();
  const newPath = `${path}.backup-${ts}`;
  renameSync(path, newPath);

  const dir = dirname(path);
  const prefix = `${basename(path)}.backup-`;
  const all = readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .map((f) => ({ name: f, ts: Number(f.slice(prefix.length)) }))
    .filter((x) => Number.isFinite(x.ts))
    .sort((a, b) => b.ts - a.ts); // newest first

  for (const old of all.slice(keep)) {
    unlinkSync(join(dir, old.name));
  }
  return newPath;
}
