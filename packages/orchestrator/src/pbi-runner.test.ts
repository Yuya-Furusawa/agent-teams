import { describe, it, expect } from "vitest";
import { resumePbiTask } from "./pbi-runner.js";

describe("resumePbiTask validation", () => {
  it("rejects unknown task_id", async () => {
    await expect(resumePbiTask({ taskId: "01HXNONEXISTENT0000", answers: {} })).rejects.toThrow(/task not found/);
  });
});
