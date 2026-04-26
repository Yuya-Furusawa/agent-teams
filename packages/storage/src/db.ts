import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "./paths.js";

export type TaskStatus = "planning" | "running" | "completed" | "failed" | "awaiting_user_input";
export type SubTaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskRow {
  id: string;
  description: string;
  cwd: string;
  team_name: string;
  status: TaskStatus;
  created_at: number;
  completed_at: number | null;
  workspace_name: string | null;
  repos: string | null;
  pbi_state: Record<string, unknown> | null;
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
  target_repo: string | null;
  /** JSON-encoded array of sibling sub_task ids that must complete first. `null` = no dependencies. */
  depends_on: string | null;
  /** 1 = initial plan, 2 = refix plan. Defaults to 1. */
  round: number;
}

export interface ResumeLock {
  pid: number;
  host: string;
  started_at: number;
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
  completed_at INTEGER,
  workspace_name TEXT,
  repos TEXT,
  pbi_state TEXT,
  design_state TEXT,
  resume_lock TEXT
);

CREATE TABLE IF NOT EXISTS sub_tasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  assigned_agent TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  target_repo TEXT,
  depends_on TEXT,
  round INTEGER NOT NULL DEFAULT 1
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
    this.migrate();
  }

  private migrate(): void {
    const taskCols = this.db.pragma("table_info(tasks)") as Array<{ name: string }>;
    const taskColNames = new Set(taskCols.map((c) => c.name));
    if (!taskColNames.has("workspace_name")) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN workspace_name TEXT`);
    }
    if (!taskColNames.has("repos")) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN repos TEXT`);
    }
    if (!taskColNames.has("pbi_state")) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN pbi_state TEXT`);
    }
    if (!taskColNames.has("design_state")) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN design_state TEXT`);
    }
    if (!taskColNames.has("resume_lock")) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN resume_lock TEXT`);
    }
    const subCols = this.db.pragma("table_info(sub_tasks)") as Array<{ name: string }>;
    const subColNames = new Set(subCols.map((c) => c.name));
    if (!subColNames.has("target_repo")) {
      this.db.exec(`ALTER TABLE sub_tasks ADD COLUMN target_repo TEXT`);
    }
    if (!subColNames.has("depends_on")) {
      this.db.exec(`ALTER TABLE sub_tasks ADD COLUMN depends_on TEXT`);
    }
    if (!subColNames.has("round")) {
      this.db.exec(`ALTER TABLE sub_tasks ADD COLUMN round INTEGER NOT NULL DEFAULT 1`);
    }
  }

  close(): void {
    this.db.close();
  }

  insertTask(
    row: Omit<TaskRow, "completed_at" | "workspace_name" | "repos" | "pbi_state"> & {
      completed_at?: number | null;
      workspace_name?: string | null;
      repos?: string | null;
      pbi_state?: Record<string, unknown> | null;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, description, cwd, team_name, status, created_at, completed_at, workspace_name, repos, pbi_state)
         VALUES (@id, @description, @cwd, @team_name, @status, @created_at, @completed_at, @workspace_name, @repos, @pbi_state)`,
      )
      .run({
        completed_at: null,
        workspace_name: null,
        repos: null,
        ...row,
        pbi_state: row.pbi_state ? JSON.stringify(row.pbi_state) : null,
      } as never);
  }

  updatePbiState(id: string, state: Record<string, unknown>): void {
    this.db.prepare(`UPDATE tasks SET pbi_state = ? WHERE id = ?`).run(JSON.stringify(state), id);
  }

  updateTaskStatus(id: string, status: TaskStatus, completedAt?: number | null): void {
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?`,
      )
      .run(status, completedAt ?? null, id);
  }

  acquireResumeLock(
    taskId: string,
    lock: ResumeLock,
    staleThresholdMs: number,
    opts?: { force?: boolean },
  ): boolean {
    const now = Date.now();
    const staleBefore = now - staleThresholdMs;
    const lockJson = JSON.stringify(lock);

    if (opts?.force) {
      const result = this.db
        .prepare(`UPDATE tasks SET resume_lock = ? WHERE id = ?`)
        .run(lockJson, taskId);
      return result.changes > 0;
    }

    const result = this.db
      .prepare(
        `UPDATE tasks SET resume_lock = ?
         WHERE id = ?
           AND (resume_lock IS NULL
                OR CAST(json_extract(resume_lock, '$.started_at') AS INTEGER) < ?)`,
      )
      .run(lockJson, taskId, staleBefore);
    return result.changes > 0;
  }

  releaseResumeLock(taskId: string, pid: number): void {
    this.db
      .prepare(
        `UPDATE tasks SET resume_lock = NULL
         WHERE id = ?
           AND CAST(json_extract(resume_lock, '$.pid') AS INTEGER) = ?`,
      )
      .run(taskId, pid);
  }

  readResumeLock(taskId: string): ResumeLock | null {
    const row = this.db
      .prepare(`SELECT resume_lock FROM tasks WHERE id = ?`)
      .get(taskId) as { resume_lock: string | null } | undefined;
    if (!row?.resume_lock) return null;
    return JSON.parse(row.resume_lock) as ResumeLock;
  }

  findResumableTaskId(): string | null {
    const row = this.db
      .prepare(
        `SELECT id FROM tasks
         WHERE status IN ('running', 'failed')
           AND pbi_state IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  countResumableTasks(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks
         WHERE status IN ('running', 'failed') AND pbi_state IS NULL`,
      )
      .get() as { n: number };
    return row.n;
  }

  insertSubTask(
    row: Omit<SubTaskRow, "completed_at" | "target_repo" | "depends_on" | "round"> & {
      completed_at?: number | null;
      target_repo?: string | null;
      depends_on?: string | null;
      round?: number;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO sub_tasks (id, task_id, title, prompt, assigned_agent, status, created_at, completed_at, target_repo, depends_on, round)
         VALUES (@id, @task_id, @title, @prompt, @assigned_agent, @status, @created_at, @completed_at, @target_repo, @depends_on, @round)`,
      )
      .run({ completed_at: null, target_repo: null, depends_on: null, round: 1, ...row });
  }

  updateSubTaskStatus(id: string, status: SubTaskStatus, completedAt?: number | null): void {
    this.db
      .prepare(
        `UPDATE sub_tasks SET status = ?, completed_at = ? WHERE id = ?`,
      )
      .run(status, completedAt ?? null, id);
  }

  getSubTaskStatus(id: string): SubTaskStatus {
    return this.db
      .prepare(`SELECT status FROM sub_tasks WHERE id = ?`)
      .pluck()
      .get(id) as SubTaskStatus;
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
    const raw = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
      | (Omit<TaskRow, "pbi_state"> & { pbi_state: string | null })
      | undefined;
    if (!raw) return undefined;
    return {
      ...raw,
      pbi_state: raw.pbi_state ? (JSON.parse(raw.pbi_state) as Record<string, unknown>) : null,
    };
  }

  listSubTasks(taskId: string): SubTaskRow[] {
    return this.db
      .prepare(`SELECT * FROM sub_tasks WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as SubTaskRow[];
  }
}
