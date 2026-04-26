import { describe, expect, it } from "vitest";
import { determineResumeStage } from "./resume-runner.js";
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
