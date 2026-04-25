import { describe, it, expect } from "vitest";
import { buildPbiPlannerPrompt, buildPbiAssemblyPrompt } from "./planner-runner.js";

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
