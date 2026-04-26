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
          subTasks: [{ id: "p1", title: "do x", prompt: "implement x", assignedAgent: "Kai" }],
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
});
