import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "@agent-teams/storage";
import { determineResumeStage, resumeTask } from "./resume-runner.js";
import type { SubTaskRow } from "@agent-teams/storage";

function sub(overrides: Partial<SubTaskRow>): SubTaskRow {
  return {
    id: "s", task_id: "t", title: "title", prompt: "p",
    assigned_agent: "Kai", status: "completed", created_at: 1,
    completed_at: 2, target_repo: null, depends_on: null, round: 1,
    ...overrides,
  };
}

const noReviewer = (id: string) => sub({ id, assigned_agent: "Kai", status: "completed", round: 1 });
const reviewer = (id: string) => sub({ id, assigned_agent: "Iris", status: "completed", round: 1 });

const roleOf = (name: string) =>
  name === "Iris" ? "code-reviewer" : "implementer";

describe("determineResumeStage", () => {
  it("returns 'triage' when no sub_tasks exist", () => {
    expect(determineResumeStage([], false, roleOf)).toBe("triage");
  });

  it("returns 'workers' when any sub_task is not completed", () => {
    expect(determineResumeStage([sub({ id: "s1", status: "failed" })], false, roleOf)).toBe("workers");
    expect(determineResumeStage([sub({ id: "s1", status: "running" })], false, roleOf)).toBe("workers");
    expect(determineResumeStage([sub({ id: "s1", status: "pending" })], false, roleOf)).toBe("workers");
  });

  it("returns 'refix-planning' when round 1 all-completed had reviewers and no round 2 exists", () => {
    expect(
      determineResumeStage([noReviewer("s1"), reviewer("s2")], false, roleOf),
    ).toBe("refix-planning");
  });

  it("returns 'summarizer' when all completed (incl. round 2) but no summary file", () => {
    expect(
      determineResumeStage(
        [noReviewer("s1"), reviewer("s2"), sub({ id: "s3", round: 2, status: "completed" })],
        false,
        roleOf,
      ),
    ).toBe("summarizer");
  });

  it("returns 'summarizer' when round 1 had no reviewers and no summary file", () => {
    // Without reviewers, refix is skipped; summarizer is the next missing step.
    expect(determineResumeStage([noReviewer("s1")], false, roleOf)).toBe("summarizer");
  });

  it("returns 'noop' when everything completed and summary exists", () => {
    expect(
      determineResumeStage(
        [noReviewer("s1"), reviewer("s2"), sub({ id: "s3", round: 2, status: "completed" })],
        true,
        roleOf,
      ),
    ).toBe("noop");
  });
});

describe("resumeTask entry", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "agent-teams-resume-entry-"));
    process.env.AGENT_TEAMS_HOME = join(tmp, "home");
    process.env.AGENT_TEAMS_AGENTS_DIR = join(tmp, "agents");
    mkdirSync(join(tmp, "agents"), { recursive: true });
    writeFileSync(join(tmp, "agents", "Sage.md"),
      `---\nname: Sage\nrole: team-planner\n---\nx`);
    writeFileSync(join(tmp, "agents", "Kai.md"),
      `---\nname: Kai\nrole: implementer\n---\nx`);
    writeFileSync(join(tmp, "agent-team.yaml"),
      `name: t\nplanner: Sage\nworkers: [Kai]\n`);
    process.chdir(tmp);
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("throws 'no resumable task found' when no failed/running tasks exist", async () => {
    await expect(resumeTask()).rejects.toThrow(/no resumable task found/);
  });

  it("rejects PBI tasks with pbi_state set", async () => {
    const s = new Storage();
    s.insertTask({
      id: "t-pbi", description: "d", cwd: tmp, team_name: "t",
      status: "running", created_at: Date.now(),
      pbi_state: { stage: "draft" },
    });
    s.close();
    await expect(resumeTask({ taskId: "t-pbi" })).rejects.toThrow(/pbi-resume/);
  });

  it("rejects already-completed taskId", async () => {
    const s = new Storage();
    s.insertTask({
      id: "t-done", description: "d", cwd: tmp, team_name: "t",
      status: "completed", created_at: Date.now(), completed_at: Date.now(),
    });
    s.close();
    await expect(resumeTask({ taskId: "t-done" })).rejects.toThrow(/already completed/);
  });

  it("noop dispatch corrects status when state is fully completed but tasks.status='failed'", async () => {
    const s = new Storage();
    s.insertTask({
      id: "t-noop", description: "d", cwd: tmp, team_name: "t",
      status: "failed", created_at: Date.now(),
    });
    s.insertSubTask({
      id: "sub1", task_id: "t-noop", title: "x", prompt: "p",
      assigned_agent: "Kai", status: "completed", created_at: Date.now(),
    });
    s.close();
    mkdirSync(join(tmp, "home", "tasks", "t-noop"), { recursive: true });
    writeFileSync(join(tmp, "home", "tasks", "t-noop", "summary.md"), "ok", "utf8");

    const result = await resumeTask({ taskId: "t-noop" });
    expect(result.stage).toBe("noop");
    expect(result.status).toBe("completed");
  });
});
