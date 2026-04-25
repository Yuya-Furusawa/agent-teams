import { describe, it, expect } from "vitest";
import { TeamSchema } from "./team.js";

describe("TeamSchema with pbi block", () => {
  it("accepts team config without pbi block (backward compat)", () => {
    const parsed = TeamSchema.parse({
      name: "default-dev-team",
      planner: "Sage",
      workers: ["Kai"],
    });
    expect(parsed.pbi).toBeUndefined();
  });
  it("accepts pbi block with vault and dir", () => {
    const parsed = TeamSchema.parse({
      name: "x",
      planner: "Sage",
      workers: ["Kai"],
      pbi: { vault: "/abs/path", dir: "PBIs/Inbox" },
    });
    expect(parsed.pbi).toEqual({ vault: "/abs/path", dir: "PBIs/Inbox" });
  });
  it("defaults dir to PBIs when omitted", () => {
    const parsed = TeamSchema.parse({
      name: "x",
      planner: "Sage",
      workers: ["Kai"],
      pbi: { vault: "/abs/path" },
    });
    expect(parsed.pbi?.dir).toBe("PBIs");
  });
  it("rejects pbi block without vault", () => {
    expect(() =>
      TeamSchema.parse({
        name: "x",
        planner: "Sage",
        workers: ["Kai"],
        pbi: { dir: "PBIs" },
      }),
    ).toThrow();
  });
});
