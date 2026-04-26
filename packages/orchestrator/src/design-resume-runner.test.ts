import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage, type DesignState } from "@agent-teams/storage";
import { resumeDesignTask } from "./design-resume-runner.js";
import { __setAgentRunnerFactoryForTests as setPlannerFactory } from "./planner-runner.js";
import { __setAgentRunnerFactoryForTests as setWorkerFactory } from "./worker-runner.js";

// Builds a planner fake that dispatches by prompt regex.
function plannerFactoryByPrompt(matches: Array<{ test: (p: string) => boolean; json: unknown }>) {
  return () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async run(opts: any) {
      for (const m of matches) {
        if (m.test(opts.prompt)) {
          return { exitCode: 0, parsedJson: m.json, lastText: JSON.stringify(m.json) };
        }
      }
      throw new Error(`no fake response matched prompt: ${(opts.prompt as string).slice(0, 200)}`);
    },
  });
}

function makeDesignState(overrides: Partial<DesignState> = {}): DesignState {
  return {
    phase: "awaiting_design_approval",
    designer_sub_task_id: "hana-1",
    iteration: 1,
    completed_sub_task_ids: ["hana-1"],
    last_checkpoint: {
      modified_files: ["design/login.pen"],
      summary: "ok",
      preview_images: [],
    },
    ...overrides,
  };
}

describe("resumeDesignTask --approve", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "agent-teams-design-resume-"));
    process.env.AGENT_TEAMS_HOME = join(tmp, "home");
    process.env.AGENT_TEAMS_AGENTS_DIR = join(tmp, "agents");
    mkdirSync(join(tmp, "agents"), { recursive: true });
    writeFileSync(join(tmp, "agents", "Sage.md"),
      `---\nname: Sage\nrole: team-planner\n---\nPlanner body.`);
    writeFileSync(join(tmp, "agents", "Hana.md"),
      `---\nname: Hana\nrole: designer\n---\nHana body.`);
    writeFileSync(join(tmp, "agents", "Kai.md"),
      `---\nname: Kai\nrole: implementer\n---\nKai body.`);
    writeFileSync(join(tmp, "agent-team.yaml"),
      `name: t\nplanner: Sage\nworkers:\n  - Hana\n  - Kai\ndefaults:\n  maxParallel: 1\n`);
    process.chdir(tmp);
  });

  afterEach(() => {
    setPlannerFactory(null);
    setWorkerFactory(null);
    delete process.env.AGENT_TEAMS_HOME;
    delete process.env.AGENT_TEAMS_AGENTS_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  function seedAwaitingTask(taskId: string): { hanaId: string; implId: string } {
    const s = new Storage();
    s.insertTask({
      id: taskId, description: "design login screen", cwd: tmp,
      team_name: "t", status: "awaiting_user_input", created_at: Date.now(),
    });
    const hanaId = "hana-1";
    const implId = "impl-1";
    s.insertSubTask({
      id: hanaId, task_id: taskId, title: "design", prompt: "p",
      assigned_agent: "Hana", status: "completed", created_at: Date.now(),
      depends_on: null, round: 1,
    });
    s.insertSubTask({
      id: implId, task_id: taskId, title: "build", prompt: "p",
      assigned_agent: "Kai", status: "pending", created_at: Date.now(),
      depends_on: JSON.stringify([hanaId]), round: 1,
    });
    s.updateDesignState(taskId, makeDesignState({
      designer_sub_task_id: hanaId,
      completed_sub_task_ids: [hanaId],
    }));
    s.close();
    return { hanaId, implId };
  }

  it("flips phase to approved and runs the impl with preCompletedIds containing Hana", async () => {
    const taskId = "task-approve-1";
    const { hanaId, implId } = seedAwaitingTask(taskId);

    setPlannerFactory(plannerFactoryByPrompt([
      // Summarizer is matched first — its prompt also contains the word
      // "refix" (when refix was skipped, the prompt explains why), so the
      // narrower marker comes first.
      { test: (p) => /summarizer for a coding-agent team/.test(p),
        json: { summary: "all done", status: "completed" } },
      { test: (p) => /refix-planning mode/.test(p),
        json: { overallStrategy: "no fixes needed", subTasks: [] } },
    ]) as never);

    const workerCalls: string[] = [];
    setWorkerFactory(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async run(opts: any) {
        workerCalls.push(opts.agent ?? "");
        return { exitCode: 0, parsedJson: null, lastText: "ok" };
      },
    }) as never);

    const result = await resumeDesignTask({ taskId, approve: true });

    expect(result.taskId).toBe(taskId);
    expect(result.status).toBe("completed");
    expect(result.iteration).toBe(1);
    expect(existsSync(result.summaryPath)).toBe(true);

    // Verify Hana was NOT re-run (preCompletedIds skipped it); Kai was.
    expect(workerCalls).not.toContain("Hana");
    expect(workerCalls).toContain("Kai");

    const s = new Storage();
    const t = s.getTask(taskId);
    expect(t?.status).toBe("completed");
    const ds = s.readDesignState(taskId);
    expect(ds?.phase).toBe("approved");
    // Hana stays completed; impl flips to completed.
    expect(s.getSubTaskStatus(hanaId)).toBe("completed");
    expect(s.getSubTaskStatus(implId)).toBe("completed");
    s.close();
  });

  it("rejects when the task is not in awaiting_user_input state", async () => {
    const s = new Storage();
    s.insertTask({
      id: "running-task", description: "d", cwd: tmp, team_name: "t",
      status: "running", created_at: Date.now(),
    });
    s.close();
    await expect(
      resumeDesignTask({ taskId: "running-task", approve: true }),
    ).rejects.toThrow(/not awaiting/);
  });

  it("rejects when the task does not exist", async () => {
    await expect(
      resumeDesignTask({ taskId: "nope", approve: true }),
    ).rejects.toThrow(/not found/);
  });

  it("rejects when design_state is missing", async () => {
    const s = new Storage();
    s.insertTask({
      id: "no-design", description: "d", cwd: tmp, team_name: "t",
      status: "awaiting_user_input", created_at: Date.now(),
    });
    s.close();
    await expect(
      resumeDesignTask({ taskId: "no-design", approve: true }),
    ).rejects.toThrow(/no design state/);
  });

  it("rejects when neither --approve nor --feedback is given", async () => {
    await expect(
      resumeDesignTask({ taskId: "anything" }),
    ).rejects.toThrow(/requires either --approve or --feedback/);
  });

  it("rejects when both --approve and --feedback are given", async () => {
    await expect(
      resumeDesignTask({ taskId: "anything", approve: true, feedback: "x" }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it("rejects when --feedback is empty string", async () => {
    await expect(
      resumeDesignTask({ taskId: "anything", feedback: "  " }),
    ).rejects.toThrow(/feedback text is required/);
  });

  it("rejects when another process holds the resume lock", async () => {
    const taskId = "task-locked";
    seedAwaitingTask(taskId);
    const s = new Storage();
    s.acquireResumeLock(
      taskId,
      { pid: process.pid + 99999, host: "other-host", started_at: Date.now() },
      30 * 60 * 1000,
    );
    s.close();
    await expect(
      resumeDesignTask({ taskId, approve: true }),
    ).rejects.toThrow(/locked by another process/);
  });
});

describe("resumeDesignTask --feedback", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "agent-teams-design-feedback-"));
    process.env.AGENT_TEAMS_HOME = join(tmp, "home");
    process.env.AGENT_TEAMS_AGENTS_DIR = join(tmp, "agents");
    mkdirSync(join(tmp, "agents"), { recursive: true });
    writeFileSync(join(tmp, "agents", "Sage.md"),
      `---\nname: Sage\nrole: team-planner\n---\nPlanner body.`);
    writeFileSync(join(tmp, "agents", "Hana.md"),
      `---\nname: Hana\nrole: designer\n---\nHana body.`);
    writeFileSync(join(tmp, "agents", "Kai.md"),
      `---\nname: Kai\nrole: implementer\n---\nKai body.`);
    writeFileSync(join(tmp, "agent-team.yaml"),
      `name: t\nplanner: Sage\nworkers:\n  - Hana\n  - Kai\ndefaults:\n  maxParallel: 1\n`);
    process.chdir(tmp);
  });

  afterEach(() => {
    setPlannerFactory(null);
    setWorkerFactory(null);
    delete process.env.AGENT_TEAMS_HOME;
    delete process.env.AGENT_TEAMS_AGENTS_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  function seedAwaitingTask(taskId: string, hanaId = "hana-1"): { hanaId: string; implId: string } {
    const s = new Storage();
    s.insertTask({
      id: taskId, description: "design login screen", cwd: tmp,
      team_name: "t", status: "awaiting_user_input", created_at: Date.now(),
    });
    const implId = "impl-1";
    s.insertSubTask({
      id: hanaId, task_id: taskId, title: "design login", prompt: "design prompt",
      assigned_agent: "Hana", status: "completed", created_at: Date.now(),
      target_repo: null, depends_on: null, round: 1,
    });
    s.insertSubTask({
      id: implId, task_id: taskId, title: "build", prompt: "p",
      assigned_agent: "Kai", status: "pending", created_at: Date.now(),
      depends_on: JSON.stringify([hanaId]), round: 1,
    });
    s.updateDesignState(taskId, makeDesignState({
      designer_sub_task_id: hanaId,
      completed_sub_task_ids: [hanaId],
    }));
    s.close();
    return { hanaId, implId };
  }

  it("inserts a new Hana sub-task, swaps depends_on, and re-pauses on a fresh checkpoint", async () => {
    const taskId = "task-feedback-1";
    const { hanaId, implId } = seedAwaitingTask(taskId);

    // Hana writes a fresh design_checkpoint report when re-run.
    const designReport = JSON.stringify({
      kind: "design_checkpoint",
      modified_files: ["design/login.pen"],
      summary: "更新しました",
      preview_images: [],
    });

    let hanaRuns = 0;
    setWorkerFactory(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async run(opts: any) {
        if (opts.agent === "Hana") {
          hanaRuns++;
          const { writeReport } = await import("@agent-teams/storage");
          // The runner-seam test stub doesn't auto-write the report; do it
          // here so parseDesignCheckpoint sees the JSON and the orchestrator
          // throws DesignCheckpointReached.
          const m = /report: (.+)$/m.exec(opts.appendSystemPrompt ?? "") ??
                    /(\S+report\.md)/.exec(opts.appendSystemPrompt ?? "");
          if (m) {
            // Best-effort path extraction; otherwise fall through to using subTaskId.
          }
          // We don't have direct access to taskId/subTaskId via opts in this
          // seam; the worker-runner sets `appendSystemPrompt` containing the
          // report path. We can't easily parse it here — so instead, derive
          // taskId+subTaskId and write through Storage path helpers.
          // The worker-runner.ts exposes them via params.taskId/subTaskId,
          // but the seam call only passes the runner.run options. So we
          // intercept differently: the inlineAgents key is the agent name.
          // We need the new sub-task ULID. We'll search the DB for the most
          // recent Hana sub-task and write directly to its report.
          const s = new Storage();
          const rows = s.db.prepare(
            "SELECT id FROM sub_tasks WHERE task_id = ? AND assigned_agent = 'Hana' ORDER BY created_at DESC LIMIT 1",
          ).all(taskId) as Array<{ id: string }>;
          if (rows[0]) {
            writeReport(taskId, rows[0].id, designReport);
          }
          s.close();
          return { exitCode: 0, parsedJson: null, lastText: designReport };
        }
        return { exitCode: 0, parsedJson: null, lastText: "ok" };
      },
    }) as never);

    setPlannerFactory(plannerFactoryByPrompt([
      { test: () => true, json: { summary: "n/a" } },
    ]) as never);

    const result = await resumeDesignTask({ taskId, feedback: "ボタンを青に" });

    expect(result.status).toBe("awaiting_user_input");
    expect(result.iteration).toBe(2);
    expect(result.taskId).toBe(taskId);
    // hanaRuns may be 1 (single Hana respawn).
    expect(hanaRuns).toBe(1);

    const s = new Storage();
    const subs = s.listSubTasks(taskId);
    // Should have: hana-1 (original, completed) + new Hana ULID + impl-1
    expect(subs.length).toBe(3);
    const hanaRows = subs.filter((x) => x.assigned_agent === "Hana");
    expect(hanaRows.length).toBe(2);
    const oldHana = hanaRows.find((x) => x.id === hanaId);
    const newHana = hanaRows.find((x) => x.id !== hanaId);
    expect(oldHana?.status).toBe("completed");
    expect(newHana?.status).toBe("completed");

    // The impl sub-task's depends_on should now reference the new Hana ULID.
    const impl = subs.find((x) => x.id === implId)!;
    expect(impl.depends_on).not.toBeNull();
    const deps = JSON.parse(impl.depends_on!) as string[];
    expect(deps).toContain(newHana!.id);
    expect(deps).not.toContain(hanaId);

    // The new Hana prompt should append the feedback section.
    expect(newHana?.prompt).toContain("User feedback (iteration 2)");
    expect(newHana?.prompt).toContain("ボタンを青に");

    const ds = s.readDesignState(taskId);
    expect(ds?.designer_sub_task_id).toBe(newHana!.id);
    expect(ds?.iteration).toBe(2);
    // completed_sub_task_ids should contain both old and new Hana ids.
    expect(ds?.completed_sub_task_ids).toContain(hanaId);
    expect(ds?.completed_sub_task_ids).toContain(newHana!.id);
    expect(ds?.phase).toBe("awaiting_design_approval");

    expect(s.getTask(taskId)?.status).toBe("awaiting_user_input");
    s.close();
  });

  it("warns to stderr when iteration > 10", async () => {
    const taskId = "task-feedback-10";
    const { hanaId } = seedAwaitingTask(taskId);
    const s = new Storage();
    s.updateDesignState(taskId, makeDesignState({
      designer_sub_task_id: hanaId,
      iteration: 10,
      completed_sub_task_ids: [hanaId],
    }));
    s.close();

    const designReport = JSON.stringify({
      kind: "design_checkpoint",
      modified_files: ["design/login.pen"],
      summary: "ok",
      preview_images: [],
    });

    setWorkerFactory(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async run(opts: any) {
        if (opts.agent === "Hana") {
          const { writeReport } = await import("@agent-teams/storage");
          const s2 = new Storage();
          const rows = s2.db.prepare(
            "SELECT id FROM sub_tasks WHERE task_id = ? AND assigned_agent = 'Hana' ORDER BY created_at DESC LIMIT 1",
          ).all(taskId) as Array<{ id: string }>;
          if (rows[0]) {
            writeReport(taskId, rows[0].id, designReport);
          }
          s2.close();
          return { exitCode: 0, parsedJson: null, lastText: designReport };
        }
        return { exitCode: 0, parsedJson: null, lastText: "ok" };
      },
    }) as never);

    setPlannerFactory(plannerFactoryByPrompt([
      { test: () => true, json: { summary: "n/a" } },
    ]) as never);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await resumeDesignTask({ taskId, feedback: "もう少し" });
      const calls = stderrSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(calls).toMatch(/iteration count exceeds 10/);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
