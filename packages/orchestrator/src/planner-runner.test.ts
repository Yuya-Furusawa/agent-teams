import { describe, it, expect } from "vitest";
import { buildPbiPlannerPrompt, buildPbiAssemblyPrompt, validatePlanDag } from "./planner-runner.js";

describe("buildPbiPlannerPrompt", () => {
  it("starts with the MODE: PBI-Planning marker on first line", () => {
    const p = buildPbiPlannerPrompt({ idea: "add X", pbiId: 42 });
    expect(p.startsWith("MODE: PBI-Planning\n")).toBe(true);
  });
  it("includes the PBI id and the raw idea", () => {
    const p = buildPbiPlannerPrompt({ idea: "add X", pbiId: 42 });
    expect(p).toContain("PBI: 42");
    expect(p).toContain("add X");
  });
  it("emits a JSON skeleton mentioning all required sub-task fields", () => {
    const p = buildPbiPlannerPrompt({ idea: "x", pbiId: 1 });
    expect(p).toContain("pax-interview");
    expect(p).toContain("pax-draft");
    expect(p).toContain("quinn");
    expect(p).toContain("aki");
    expect(p).toContain("\"title\":");
    expect(p).toContain("\"targetRepo\": null");
  });
});

describe("buildPbiAssemblyPrompt", () => {
  it("starts with MODE: PBI-Assembly marker", () => {
    const p = buildPbiAssemblyPrompt({
      idea: "x",
      pbiId: 42,
      reports: {
        pax: { status: "completed", content: "pax body" },
        quinn: { status: "completed", content: "quinn body" },
        aki: { status: "completed", content: "aki body" },
      },
    });
    expect(p.startsWith("MODE: PBI-Assembly\n")).toBe(true);
  });
  it("includes each worker's status and content", () => {
    const p = buildPbiAssemblyPrompt({
      idea: "x",
      pbiId: 1,
      reports: {
        pax: { status: "completed", content: "PAX!" },
        quinn: { status: "failed", content: "" },
        aki: { status: "completed", content: "AKI!" },
      },
    });
    expect(p).toContain("PAX!");
    expect(p).toContain("status: failed");
    expect(p).toContain("AKI!");
  });
});

describe("validatePlanDag — Hana layer-0 invariant", () => {
  const roleOf = (name: string) => (name === "Hana" ? "designer" : "implementer");

  it("rejects a plan where Hana exists with dependsOn:[] but other sub-tasks omit her", () => {
    const plan = {
      overallStrategy: "x",
      subTasks: [
        { id: "design", title: "t", prompt: "p", assignedAgent: "Hana", dependsOn: [] },
        { id: "impl", title: "t", prompt: "p", assignedAgent: "Kai", dependsOn: [] },
      ],
    };
    expect(() => validatePlanDag(plan, roleOf)).toThrow(/Hana.*dependsOn|dependsOn.*Hana|design.*dependsOn/);
  });

  it("accepts a plan where every other round-1 sub-task depends on Hana", () => {
    const plan = {
      overallStrategy: "x",
      subTasks: [
        { id: "design", title: "t", prompt: "p", assignedAgent: "Hana", dependsOn: [] },
        { id: "impl", title: "t", prompt: "p", assignedAgent: "Kai", dependsOn: ["design"] },
        { id: "rev",  title: "t", prompt: "p", assignedAgent: "Iris", dependsOn: ["design", "impl"] },
      ],
    };
    expect(() => validatePlanDag(plan, roleOf)).not.toThrow();
  });

  it("does nothing special when Hana is not in the plan", () => {
    const plan = {
      overallStrategy: "x",
      subTasks: [
        { id: "impl", title: "t", prompt: "p", assignedAgent: "Kai", dependsOn: [] },
      ],
    };
    expect(() => validatePlanDag(plan, roleOf)).not.toThrow();
  });
});
