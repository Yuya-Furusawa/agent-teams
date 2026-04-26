import { describe, it, expect } from "vitest";
import { parseInterviewReport, parseDesignCheckpoint } from "./checkpoint-parse.js";

describe("parseInterviewReport", () => {
  it("returns ok for empty report", () => {
    expect(parseInterviewReport("")).toEqual({ kind: "ok" });
  });
  it("returns ok when needs_input is false", () => {
    expect(parseInterviewReport(`{"needs_input": false}`)).toEqual({ kind: "ok" });
  });
  it("returns questions for raw JSON", () => {
    const r = parseInterviewReport(
      `{"needs_input":true,"questions":[{"id":"q1","question":"Why?"}]}`,
    );
    expect(r).toEqual({ kind: "questions", questions: [{ id: "q1", question: "Why?" }] });
  });
  it("returns questions from a fenced JSON block", () => {
    const r = parseInterviewReport(
      "preface\n```json\n{\"needs_input\":true,\"questions\":[{\"id\":\"q1\",\"question\":\"X?\"}]}\n```",
    );
    expect(r.kind).toBe("questions");
  });
});

describe("parseDesignCheckpoint", () => {
  it("returns null for empty report", () => {
    expect(parseDesignCheckpoint("")).toBeNull();
  });
  it("returns null without discriminator", () => {
    expect(
      parseDesignCheckpoint(`{"modified_files":["a.pen"],"summary":"x"}`),
    ).toBeNull();
  });
  it("returns null with wrong discriminator", () => {
    expect(
      parseDesignCheckpoint(
        `{"kind":"questions","modified_files":["a.pen"],"summary":"x"}`,
      ),
    ).toBeNull();
  });
  it("parses a valid checkpoint", () => {
    const r = parseDesignCheckpoint(
      `{"kind":"design_checkpoint","modified_files":["a.pen"],"summary":"x","preview_images":["p.png"]}`,
    );
    expect(r).toEqual({
      modified_files: ["a.pen"],
      summary: "x",
      preview_images: ["p.png"],
    });
  });
  it("parses checkpoint from a fenced block at the end of a markdown report", () => {
    const r = parseDesignCheckpoint(
      "## Summary\n変更しました\n\n```json\n{\"kind\":\"design_checkpoint\",\"modified_files\":[\"login.pen\"],\"summary\":\"done\",\"preview_images\":[]}\n```\n",
    );
    expect(r?.modified_files).toEqual(["login.pen"]);
  });
  it("treats non-string array entries as filtered out", () => {
    const r = parseDesignCheckpoint(
      `{"kind":"design_checkpoint","modified_files":["a.pen",123,null],"summary":"s"}`,
    );
    expect(r?.modified_files).toEqual(["a.pen"]);
    expect(r?.preview_images).toEqual([]);
  });
  it("returns null when modified_files is not an array", () => {
    expect(
      parseDesignCheckpoint(
        `{"kind":"design_checkpoint","modified_files":"a.pen","summary":"s"}`,
      ),
    ).toBeNull();
  });
});
