import { describe, it, expect } from "vitest";
import { resumePbiTask, runPbiTask } from "./pbi-runner.js";

describe("resumePbiTask validation", () => {
  it("rejects unknown task_id", async () => {
    await expect(resumePbiTask({ taskId: "01HXNONEXISTENT0000", answers: {} })).rejects.toThrow(/task not found/);
  });
});

describe("runPbiTask option validation", () => {
  it("rejects --workspace combined with --cwd", async () => {
    await expect(
      runPbiTask({ idea: "x", cwd: "/tmp", workspace: "my-ws" }),
    ).rejects.toThrow(/--workspace cannot be combined with --cwd/);
  });
});
