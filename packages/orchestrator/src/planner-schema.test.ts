import { describe, expect, it } from "vitest";
import {
  RefixPlanSchema,
  TaskPlanSchema,
  buildRefixPlannerPrompt,
  buildRefixWorkerPrompt,
  buildSummaryPrompt,
} from "./planner-schema.js";

describe("TaskPlanSchema targetRepo", () => {
  it("accepts targetRepo: null (PBI mode emits null per spec)", () => {
    const parsed = TaskPlanSchema.parse({
      overallStrategy: "x",
      subTasks: [
        { id: "a", title: "t", prompt: "p", assignedAgent: "Pax", targetRepo: null, dependsOn: [] },
      ],
    });
    expect(parsed.subTasks[0]!.targetRepo).toBeNull();
  });
  it("accepts targetRepo omitted entirely", () => {
    const parsed = TaskPlanSchema.parse({
      overallStrategy: "x",
      subTasks: [{ id: "a", title: "t", prompt: "p", assignedAgent: "Pax", dependsOn: [] }],
    });
    expect(parsed.subTasks[0]!.targetRepo).toBeUndefined();
  });
});

describe("RefixPlanSchema", () => {
  it("accepts an empty subTasks array", () => {
    const parsed = RefixPlanSchema.parse({
      overallStrategy: "No must-fix findings; refix unnecessary.",
      subTasks: [],
    });
    expect(parsed.subTasks).toEqual([]);
  });

  it("requires overallStrategy to be non-empty", () => {
    expect(() =>
      RefixPlanSchema.parse({ overallStrategy: "", subTasks: [] }),
    ).toThrow();
  });

  it("accepts subTasks with dependsOn", () => {
    const parsed = RefixPlanSchema.parse({
      overallStrategy: "Address must-fix from Iris on API handler.",
      subTasks: [
        { id: "refix-kai", title: "Fix API", prompt: "…", assignedAgent: "Kai" },
        {
          id: "rereview-iris",
          title: "Re-review",
          prompt: "…",
          assignedAgent: "Iris",
          dependsOn: ["refix-kai"],
        },
      ],
    });
    expect(parsed.subTasks.length).toBe(2);
  });
});

describe("buildRefixPlannerPrompt", () => {
  it("includes round 1 reports and implementer→file mapping", () => {
    const p = buildRefixPlannerPrompt({
      task: "Build the API",
      cwd: "/repo",
      round1Reports: [
        {
          subTaskId: "ulid-1",
          title: "Implement API",
          assignedAgent: "Kai",
          role: "implementer",
          status: "completed",
          report: "# 実施内容\n...\n— Kai",
        },
        {
          subTaskId: "ulid-2",
          title: "Review correctness",
          assignedAgent: "Iris",
          role: "code-reviewer",
          status: "completed",
          report: "## Must-fix\n- handler.ts:42 missing null check\n— Iris",
        },
      ],
      originalPlan: [
        {
          id: "impl-api",
          title: "Implement API",
          prompt: "",
          assignedAgent: "Kai",
        },
      ],
    });
    expect(p).toContain("Kai");
    expect(p).toContain("Iris");
    expect(p).toContain("handler.ts:42");
    expect(p).toContain("must-fix");
    expect(p).toContain("Vale");
  });

  it("reflects the original plan's implementer list in the implementer→sub-task mapping", () => {
    const p = buildRefixPlannerPrompt({
      task: "Prose edit",
      cwd: "/repo",
      round1Reports: [
        { subTaskId: "u1", title: "Edit docs", assignedAgent: "Lin", role: "docs-writer", status: "completed", report: "done" },
      ],
      originalPlan: [{ id: "docs", title: "Edit docs", prompt: "", assignedAgent: "Lin" }],
    });
    expect(p).toContain("docs → Lin");
    expect(p).not.toContain("Kai");
  });
});

describe("buildRefixWorkerPrompt", () => {
  it("bundles findings and original report reference", () => {
    const p = buildRefixWorkerPrompt({
      originalReportPath: "/tasks/t/agents/impl/report.md",
      findings: [
        { reviewer: "Iris", severity: "must-fix", body: "handler.ts:42 null check missing" },
        { reviewer: "Vale", severity: "nice-to-fix", body: "handler.ts:60 CSRF token not validated" },
      ],
    });
    expect(p).toContain("handler.ts:42");
    expect(p).toContain("CSRF");
    expect(p).toContain("Iris");
    expect(p).toContain("Vale");
    expect(p).toContain("must-fix");
    expect(p).toContain("nice-to-fix");
  });
});

describe("buildSummaryPrompt (round-aware)", () => {
  it("labels round-2 sections in the prompt", () => {
    const p = buildSummaryPrompt({
      task: "Build",
      cwd: "/",
      subTaskReports: [
        { title: "Impl", agent: "Kai", status: "completed", report: "r1", round: 1 },
        { title: "Refix", agent: "Kai", status: "completed", report: "r2", round: 2 },
      ],
    });
    expect(p).toContain("[round 1]");
    expect(p).toContain("[round 2]");
  });
});
