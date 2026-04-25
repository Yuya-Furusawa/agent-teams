import { describe, it, expect } from "vitest";
import { WorkspaceSchema } from "./workspace.js";

describe("WorkspaceSchema with pbi block", () => {
  it("accepts workspace without pbi block (backward compat)", () => {
    const parsed = WorkspaceSchema.parse({
      name: "ws",
      repos: [{ name: "fe", path: "/abs/fe" }],
    });
    expect(parsed.pbi).toBeUndefined();
  });
  it("accepts workspace with pbi block", () => {
    const parsed = WorkspaceSchema.parse({
      name: "ws",
      repos: [{ name: "fe", path: "/abs/fe" }],
      pbi: { vault: "/abs/vault", dir: "PBIs/Inbox" },
    });
    expect(parsed.pbi).toEqual({ vault: "/abs/vault", dir: "PBIs/Inbox" });
  });
});
