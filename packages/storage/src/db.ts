import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "./paths.js";

export type TaskStatus = "planning" | "running" | "completed" | "failed";
export type SubTaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskRow {
  id: string;
  description: string;
  cwd: string;
  team_name: string;
  status: TaskStatus;
  created_at: number;
  completed_at: number | null;
}

export interface SubTaskRow {
  id: string;
  task_id: string;
  title: string;
  prompt: string;
  assigned_agent: string;
  status: SubTaskStatus;
  created_at: number;
  completed_at: number | null;
}

export interface AgentRunRow {
  id: string;
  sub_task_id: string;
  pane_ref: string | null;
  pid: number | null;
  exit_code: number | null;
  started_at: number;
  completed_at: number | null;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  cwd TEXT NOT NULL,
  team_name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS sub_tasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  assigned_agent TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sub_tasks_task_id ON sub_tasks(task_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  sub_task_id TEXT NOT NULL REFERENCES sub_tasks(id) ON DELETE CASCADE,
  pane_ref TEXT,
  pid INTEGER,
  exit_code INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_sub_task_id ON agent_runs(sub_task_id);
`;

export class Storage {
  readonly db: Database.Database;

  constructor(path: string = dbPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  insertTask(row: Omit<TaskRow, "completed_at"> & { completed_at?: number | null }): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, description, cwd, team_name, status, created_at, completed_at)
         VALUES (@id, @description, @cwd, @team_name, @status, @created_at, @completed_at)`,
      )
      .run({ completed_at: null, ...row });
  }

  updateTaskStatus(id: string, status: TaskStatus, completedAt?: number | null): void {
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?`,
      )
      .run(status, completedAt ?? null, id);
  }

  insertSubTask(row: Omit<SubTaskRow, "completed_at"> & { completed_at?: number | null }): void {
    this.db
      .prepare(
        `INSERT INTO sub_tasks (id, task_id, title, prompt, assigned_agent, status, created_at, completed_at)
         VALUES (@id, @task_id, @title, @prompt, @assigned_agent, @status, @created_at, @completed_at)`,
      )
      .run({ completed_at: null, ...row });
  }

  updateSubTaskStatus(id: string, status: SubTaskStatus, completedAt?: number | null): void {
    this.db
      .prepare(
        `UPDATE sub_tasks SET status = ?, completed_at = ? WHERE id = ?`,
      )
      .run(status, completedAt ?? null, id);
  }

  insertAgentRun(row: Omit<AgentRunRow, "exit_code" | "completed_at"> & {
    exit_code?: number | null;
    completed_at?: number | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO agent_runs (id, sub_task_id, pane_ref, pid, exit_code, started_at, completed_at)
         VALUES (@id, @sub_task_id, @pane_ref, @pid, @exit_code, @started_at, @completed_at)`,
      )
      .run({ exit_code: null, completed_at: null, ...row });
  }

  updateAgentRun(id: string, exitCode: number | null, completedAt: number): void {
    this.db
      .prepare(
        `UPDATE agent_runs SET exit_code = ?, completed_at = ? WHERE id = ?`,
      )
      .run(exitCode, completedAt, id);
  }

  getTask(id: string): TaskRow | undefined {
    return this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
  }

  listSubTasks(taskId: string): SubTaskRow[] {
    return this.db
      .prepare(`SELECT * FROM sub_tasks WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as SubTaskRow[];
  }
}
