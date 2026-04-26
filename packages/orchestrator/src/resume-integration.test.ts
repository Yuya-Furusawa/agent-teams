import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTask } from "./orchestrator.js";
import { resumeTask } from "./resume-runner.js";
import { __setAgentRunnerFactoryForTests as setPlannerFactory } from "./planner-runner.js";
import { __setAgentRunnerFactoryForTests as setWorkerFactory } from "./worker-runner.js";

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

describe("resumeTask integration", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "agent-teams-resume-"));
    process.env.AGENT_TEAMS_HOME = join(tmp, "home");
    process.env.AGENT_TEAMS_AGENTS_DIR = join(tmp, "agents");
    mkdirSync(join(tmp, "agents"), { recursive: true });
    writeFileSync(join(tmp, "agents", "Sage.md"),
      `---\nname: Sage\nrole: team-planner\n---\nPlanner body.`);
    writeFileSync(join(tmp, "agents", "Kai.md"),
      `---\nname: Kai\nrole: implementer\n---\nKai body.`);
    writeFileSync(join(tmp, "agent-team.yaml"),
      `name: test\nplanner: Sage\nworkers:\n  - Kai\ndefaults:\n  maxParallel: 1\n`);
    process.chdir(tmp);
  });

  afterEach(() => {
    setPlannerFactory(null);
    setWorkerFactory(null);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("resumes a task whose only worker failed and reaches completed status", async () => {
    setPlannerFactory(plannerFactoryByPrompt([
      // Triage prompt mentions "TRIAGE mode" (unique to triage).
      { test: (p) => /TRIAGE mode/.test(p),
        json: { difficulty: "small", selectedAgents: ["Kai"] } },
      // Plan prompt mentions "planner for a team of coding agents" (unique).
      { test: (p) => /planner for a team of coding agents/.test(p),
        json: {
          overallStrategy: "one impl",
          subTasks: [{ id: "p1", title: "do x", prompt: "implement x", assignedAgent: "Kai", targetRepo: "(local)" }],
        } },
      // Summarizer prompt mentions "summarizer".
      { test: (p) => /summari/i.test(p),
        json: { summary: "all done" } },
    ]) as never);

    let workerCalls = 0;
    setWorkerFactory(() => ({
      async run() {
        workerCalls++;
        return workerCalls === 1
          ? { exitCode: 1, parsedJson: null, lastText: "limit hit" }
          : { exitCode: 0, parsedJson: null, lastText: "ok" };
      },
    }) as never);

    // Initial run: worker fails on first attempt → task ends 'failed'.
    const first = await runTask({ description: "do thing", cwd: tmp }).catch(() => null);
    expect(first?.status ?? "failed").toBe("failed");

    // Resume: worker now succeeds on second attempt.
    const resumed = await resumeTask();
    expect(resumed.status).toBe("completed");
    expect(resumed.stage).toBe("workers");
    expect(existsSync(resumed.summaryPath)).toBe(true);
  });

  it("resumes from triage when triage failed (no sub_tasks in DB)", async () => {
    let triageAttempts = 0;
    setPlannerFactory(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async run(opts: any) {
        // First triage call fails; subsequent triage / planner / summarizer succeed.
        if (/TRIAGE mode/.test(opts.prompt)) {
          triageAttempts++;
          if (triageAttempts === 1) throw new Error("simulated triage failure");
          return { exitCode: 0, parsedJson: { difficulty: "small", selectedAgents: ["Kai"] },
                   lastText: '{"difficulty":"small","selectedAgents":["Kai"]}' };
        }
        if (/planner for a team of coding agents/.test(opts.prompt)) {
          return { exitCode: 0, parsedJson: {
            overallStrategy: "one impl",
            subTasks: [{ id: "p1", title: "x", prompt: "p", assignedAgent: "Kai", targetRepo: "(local)" }],
          }, lastText: "{}" };
        }
        if (/summari/i.test(opts.prompt)) {
          return { exitCode: 0, parsedJson: { summary: "ok" }, lastText: "{}" };
        }
        throw new Error(`no fake response for: ${(opts.prompt as string).slice(0, 200)}`);
      },
    }) as never);
    setWorkerFactory(() => ({
      async run() { return { exitCode: 0, parsedJson: null, lastText: "ok" }; },
    }) as never);

    await runTask({ description: "do thing", cwd: tmp }).catch(() => null);
    const resumed = await resumeTask();
    expect(resumed.status).toBe("completed");
    expect(resumed.stage).toBe("triage");
  });

  it("rejects a second resume while a first holds the lock", async () => {
    // Pre-seed a failed task and acquire a fake lock on it directly.
    const { Storage } = await import("@agent-teams/storage");
    const s = new Storage();
    s.insertTask({
      id: "t-locked", description: "d", cwd: tmp, team_name: "test",
      status: "failed", created_at: Date.now(),
    });
    // Hold the lock with a synthetic pid different from process.pid.
    s.acquireResumeLock(
      "t-locked",
      { pid: process.pid + 12345, host: "other-host", started_at: Date.now() },
      30 * 60 * 1000,
    );
    s.close();
    await expect(resumeTask({ taskId: "t-locked" })).rejects.toThrow(/locked by another process/);
  });

  it("rejects PBI tasks (pbi_state IS NOT NULL) when explicitly targeted", async () => {
    const { Storage } = await import("@agent-teams/storage");
    const s = new Storage();
    s.insertTask({
      id: "t-pbi", description: "PBI draft", cwd: tmp, team_name: "test",
      status: "running", created_at: Date.now(),
      pbi_state: { stage: "draft", pbiId: 42 },
    });
    s.close();
    await expect(resumeTask({ taskId: "t-pbi" })).rejects.toThrow(/pbi-resume/);
  });
});
