import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Storage } from "./db.js";

describe("Storage migration", () => {
  let dir: string;
  let dbFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-teams-storage-"));
    dbFile = join(dir, "db.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds round column to sub_tasks on legacy DB and defaults existing rows to 1", () => {
    const legacy = new Database(dbFile);
    legacy.exec(`
      CREATE TABLE tasks (id TEXT PRIMARY KEY, description TEXT NOT NULL, cwd TEXT NOT NULL,
        team_name TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER);
      CREATE TABLE sub_tasks (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL,
        prompt TEXT NOT NULL, assigned_agent TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER);
      INSERT INTO tasks VALUES ('t1','d','/w','default','completed',100,200);
      INSERT INTO sub_tasks VALUES ('s1','t1','one','p','Kai','completed',100,150);
    `);
    legacy.close();

    const storage = new Storage(dbFile);
    const cols = storage.db.pragma("table_info(sub_tasks)") as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("round");

    const row = storage.db
      .prepare("SELECT round FROM sub_tasks WHERE id = 's1'")
      .get() as { round: number };
    expect(row.round).toBe(1);
    storage.close();
  });

  it("insertSubTask writes the supplied round value", () => {
    const storage = new Storage(dbFile);
    storage.insertTask({
      id: "t1", description: "d", cwd: "/w", team_name: "default",
      status: "running", created_at: 100,
    });
    storage.insertSubTask({
      id: "s1", task_id: "t1", title: "x", prompt: "p",
      assigned_agent: "Kai", status: "pending", created_at: 100,
      round: 2,
    });
    const row = storage.db
      .prepare("SELECT round FROM sub_tasks WHERE id = 's1'")
      .get() as { round: number };
    expect(row.round).toBe(2);
    storage.close();
  });
});

describe("PBI state column", () => {
  it("accepts awaiting_user_input status", () => {
    const path = `${tmpdir()}/agent-teams-pbi-${Date.now()}.sqlite`;
    const storage = new Storage(path);
    try {
      storage.insertTask({
        id: "t1",
        description: "test",
        cwd: "/",
        team_name: "t",
        status: "awaiting_user_input" as any,
        created_at: 1,
      });
      const t = storage.getTask("t1");
      expect(t?.status).toBe("awaiting_user_input");
    } finally {
      storage.close();
    }
  });

  it("stores and reads pbi_state JSON", () => {
    const path = `${tmpdir()}/agent-teams-pbi-${Date.now()}.sqlite`;
    const storage = new Storage(path);
    try {
      storage.insertTask({
        id: "t2",
        description: "test",
        cwd: "/",
        team_name: "t",
        status: "running",
        created_at: 1,
      });
      const state = { phase: "awaiting_user_input", pbi_id: 42 } as const;
      storage.updatePbiState("t2", state);
      const t = storage.getTask("t2");
      expect(t?.pbi_state).toEqual(state);
    } finally {
      storage.close();
    }
  });
});

describe("resume_lock column migration", () => {
  let dir: string;
  let dbFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-teams-storage-"));
    dbFile = join(dir, "db.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds resume_lock column to legacy DB and defaults existing rows to NULL", () => {
    const legacy = new Database(dbFile);
    legacy.exec(`
      CREATE TABLE tasks (id TEXT PRIMARY KEY, description TEXT NOT NULL, cwd TEXT NOT NULL,
        team_name TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER);
      INSERT INTO tasks VALUES ('t1','d','/w','default','failed',100,200);
    `);
    legacy.close();

    const storage = new Storage(dbFile);
    const cols = storage.db.pragma("table_info(tasks)") as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("resume_lock");

    const row = storage.db
      .prepare("SELECT resume_lock FROM tasks WHERE id = 't1'")
      .get() as { resume_lock: string | null };
    expect(row.resume_lock).toBeNull();
    storage.close();
  });

  it("adds design_state column to legacy DB and defaults existing rows to NULL", () => {
    const legacy = new Database(dbFile);
    legacy.exec(`
      CREATE TABLE tasks (id TEXT PRIMARY KEY, description TEXT NOT NULL, cwd TEXT NOT NULL,
        team_name TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER);
      INSERT INTO tasks VALUES ('t1','d','/w','default','running',100,NULL);
    `);
    legacy.close();
    const storage = new Storage(dbFile);
    const cols = storage.db.pragma("table_info(tasks)") as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("design_state");
    const row = storage.db
      .prepare("SELECT design_state FROM tasks WHERE id = 't1'")
      .get() as { design_state: string | null };
    expect(row.design_state).toBeNull();
    storage.close();
  });
});

describe("resume_lock and findResumableTaskId", () => {
  let dir: string;
  let dbFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-teams-lock-"));
    dbFile = join(dir, "db.sqlite");
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function makeTask(s: Storage, id: string, status: string, createdAt: number, opts?: { pbi?: boolean }) {
    s.insertTask({
      id, description: "d", cwd: "/w", team_name: "t",
      status: status as any, created_at: createdAt,
      ...(opts?.pbi ? { pbi_state: { stage: "interview" } } : {}),
    });
  }

  it("acquireResumeLock succeeds when lock is null", () => {
    const s = new Storage(dbFile);
    makeTask(s, "t1", "failed", 100);
    const lock = { pid: 999, host: "h", started_at: Date.now() };
    expect(s.acquireResumeLock("t1", lock, 30 * 60 * 1000)).toBe(true);
    s.close();
  });

  it("acquireResumeLock fails when lock is held within stale threshold", () => {
    const s = new Storage(dbFile);
    makeTask(s, "t1", "failed", 100);
    const now = Date.now();
    s.acquireResumeLock("t1", { pid: 1, host: "h", started_at: now }, 30 * 60 * 1000);
    expect(s.acquireResumeLock("t1", { pid: 2, host: "h", started_at: now }, 30 * 60 * 1000)).toBe(false);
    s.close();
  });

  it("acquireResumeLock overrides stale lock past threshold", () => {
    const s = new Storage(dbFile);
    makeTask(s, "t1", "failed", 100);
    s.acquireResumeLock("t1", { pid: 1, host: "h", started_at: 1000 }, 100);
    // 100ms threshold; original lock is far older than threshold relative to "now"
    expect(s.acquireResumeLock("t1", { pid: 2, host: "h", started_at: Date.now() }, 100)).toBe(true);
    s.close();
  });

  it("acquireResumeLock with force overrides any existing lock", () => {
    const s = new Storage(dbFile);
    makeTask(s, "t1", "failed", 100);
    s.acquireResumeLock("t1", { pid: 1, host: "h", started_at: Date.now() }, 30 * 60 * 1000);
    expect(s.acquireResumeLock("t1", { pid: 2, host: "h", started_at: Date.now() }, 30 * 60 * 1000, { force: true })).toBe(true);
    s.close();
  });

  it("releaseResumeLock only clears when pid matches", () => {
    const s = new Storage(dbFile);
    makeTask(s, "t1", "failed", 100);
    s.acquireResumeLock("t1", { pid: 1, host: "h", started_at: Date.now() }, 30 * 60 * 1000);
    s.releaseResumeLock("t1", 999); // wrong pid
    const stillLocked = (s.db.prepare("SELECT resume_lock FROM tasks WHERE id = 't1'").get() as { resume_lock: string | null }).resume_lock;
    expect(stillLocked).not.toBeNull();
    s.releaseResumeLock("t1", 1); // correct pid
    const cleared = (s.db.prepare("SELECT resume_lock FROM tasks WHERE id = 't1'").get() as { resume_lock: string | null }).resume_lock;
    expect(cleared).toBeNull();
    s.close();
  });

  it("findResumableTaskId returns most recent failed/running, excluding awaiting_user_input and PBI", () => {
    const s = new Storage(dbFile);
    makeTask(s, "old", "failed", 100);
    makeTask(s, "new", "running", 200);
    makeTask(s, "pbi", "running", 300, { pbi: true });
    makeTask(s, "awaiting", "awaiting_user_input", 400);
    makeTask(s, "completed", "completed", 500);
    expect(s.findResumableTaskId()).toBe("new");
    s.close();
  });

  it("findResumableTaskId returns null when no candidates", () => {
    const s = new Storage(dbFile);
    makeTask(s, "completed", "completed", 100);
    expect(s.findResumableTaskId()).toBeNull();
    s.close();
  });

  it("countResumableTasks returns the number of candidates", () => {
    const s = new Storage(dbFile);
    makeTask(s, "a", "failed", 100);
    makeTask(s, "b", "running", 200);
    makeTask(s, "c", "running", 300, { pbi: true });
    expect(s.countResumableTasks()).toBe(2);
    s.close();
  });
});
