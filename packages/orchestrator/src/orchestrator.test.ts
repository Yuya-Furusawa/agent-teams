import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTask } from "./orchestrator.js";
import {
  __setAgentRunnerFactoryForTests as setPlannerFactory,
} from "./planner-runner.js";
import {
  __setAgentRunnerFactoryForTests as setWorkerFactory,
} from "./worker-runner.js";

// Minimal fake runner that serves deterministic JSON based on the prompt contents.
function fakeRunnerFactory(
  responses: Array<{ match: RegExp; json: unknown; lastText?: string }>,
) {
  return () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async run(opts: any) {
      for (const r of responses) {
        if (r.match.test(opts.prompt)) {
          return {
            exitCode: 0,
            parsedJson: r.json,
            lastText: r.lastText ?? JSON.stringify(r.json),
          };
        }
      }
      throw new Error(`no fake response matched prompt: ${opts.prompt.slice(0, 200)}`);
    },
  });
}

describe("runTask with refix phase", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "agent-teams-orch-"));
    writeFileSync(
      join(tmp, "agent-team.yaml"),
      `name: test\nplanner: Sage\nworkers:\n  - Kai\n  - Iris\ndefaults:\n  maxParallel: 2\n`,
    );
    process.env.AGENT_TEAMS_HOME = join(tmp, "home");
    process.env.AGENT_TEAMS_AGENTS_DIR = join(tmp, "agents");
    mkdirSync(join(tmp, "agents"), { recursive: true });
    writeFileSync(
      join(tmp, "agents", "Sage.md"),
      `---\nname: Sage\nrole: team-planner\n---\nPlanner body.`,
    );
    writeFileSync(
      join(tmp, "agents", "Kai.md"),
      `---\nname: Kai\nrole: implementer\n---\nKai body.`,
    );
    writeFileSync(
      join(tmp, "agents", "Iris.md"),
      `---\nname: Iris\nrole: code-reviewer\n---\nIris body.`,
    );
  });

  afterEach(() => {
    setPlannerFactory(null);
    setWorkerFactory(null);
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.AGENT_TEAMS_HOME;
    delete process.env.AGENT_TEAMS_AGENTS_DIR;
  });

  it("skips round 2 when refix plan is empty", async () => {
    const workerRuns: string[] = [];
    setWorkerFactory(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async run(opts: any) {
        workerRuns.push(opts.agent ?? "");
        return { exitCode: 0, parsedJson: null, lastText: "done" };
      },
    }));

    setPlannerFactory(
      fakeRunnerFactory([
        {
          match: /TRIAGE/,
          json: { difficulty: "small", selectedAgents: ["Kai", "Iris"], rationale: "tiny change" },
        },
        {
          match: /planner for a team of coding agents\./,
          json: {
            overallStrategy: "one impl + one reviewer",
            subTasks: [
              { id: "impl", title: "Implement", prompt: "do it", assignedAgent: "Kai" },
              { id: "review", title: "Review", prompt: "review it", assignedAgent: "Iris", dependsOn: ["impl"] },
            ],
          },
        },
        {
          match: /refix-planning mode/,
          json: { overallStrategy: "No must-fix findings.", subTasks: [] },
        },
        {
          match: /summarizer/,
          json: { summary: "done", status: "success" },
        },
      ]),
    );

    const result = await runTask({ description: "test task", cwd: tmp });
    expect(result.status).toBe("completed");
    expect(workerRuns.sort()).toEqual(["Iris", "Kai"]);
  });

  it("runs round 2 workers when refix plan is non-empty and assigns original implementer", async () => {
    const workerRuns: Array<{ agent: string; prompt: string }> = [];
    setWorkerFactory(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async run(opts: any) {
        workerRuns.push({ agent: opts.agent ?? "", prompt: opts.prompt });
        return { exitCode: 0, parsedJson: null, lastText: "done" };
      },
    }));

    setPlannerFactory(
      fakeRunnerFactory([
        {
          match: /TRIAGE/,
          json: { difficulty: "small", selectedAgents: ["Kai", "Iris"], rationale: "tiny" },
        },
        {
          match: /planner for a team of coding agents\./,
          json: {
            overallStrategy: "impl + review",
            subTasks: [
              { id: "impl", title: "Implement", prompt: "do it", assignedAgent: "Kai" },
              { id: "review", title: "Review", prompt: "review it", assignedAgent: "Iris", dependsOn: ["impl"] },
            ],
          },
        },
        {
          match: /refix-planning mode/,
          json: {
            overallStrategy: "Iris raised a must-fix on null check.",
            subTasks: [
              { id: "refix-kai", title: "Fix null check", prompt: "fix it", assignedAgent: "Kai" },
              { id: "rereview", title: "Re-review", prompt: "verify", assignedAgent: "Iris", dependsOn: ["refix-kai"] },
            ],
          },
        },
        {
          match: /summarizer/,
          json: { summary: "done after refix", status: "success" },
        },
      ]),
    );

    const result = await runTask({ description: "test task", cwd: tmp });
    expect(result.status).toBe("completed");
    expect(workerRuns.length).toBe(4);
    const kaiRuns = workerRuns.filter((w) => w.agent === "Kai");
    expect(kaiRuns.length).toBe(2);
    expect(kaiRuns[1]!.prompt).toContain("fix it");
  });

  it("skips refix planning when round 1 has no reviewers", async () => {
    const workerRuns: string[] = [];
    setWorkerFactory(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async run(opts: any) {
        workerRuns.push(opts.agent ?? "");
        return { exitCode: 0, parsedJson: null, lastText: "done" };
      },
    }));

    const refixSpy = vi.fn();
    setPlannerFactory(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async run(opts: any) {
        if (/refix-planning mode/.test(opts.prompt)) {
          refixSpy();
          return { exitCode: 0, parsedJson: { overallStrategy: "x", subTasks: [] }, lastText: "{}" };
        }
        if (/TRIAGE/.test(opts.prompt)) {
          return { exitCode: 0, parsedJson: { difficulty: "trivial", selectedAgents: ["Kai"], rationale: "x" }, lastText: "" };
        }
        if (/summarizer/.test(opts.prompt)) {
          return { exitCode: 0, parsedJson: { summary: "x", status: "success" }, lastText: "" };
        }
        return {
          exitCode: 0,
          parsedJson: {
            overallStrategy: "one impl",
            subTasks: [{ id: "impl", title: "Do", prompt: "p", assignedAgent: "Kai" }],
          },
          lastText: "",
        };
      },
    }));

    await runTask({ description: "trivial", cwd: tmp });
    expect(refixSpy).not.toHaveBeenCalled();
    expect(workerRuns).toEqual(["Kai"]);
  });
});
