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
});
