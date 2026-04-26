import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceSchema, scanDesignFiles } from "./workspace.js";

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

describe("scanDesignFiles", () => {
  it("returns empty designFiles when no .pen files exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-"));
    const repos = [{ name: "r1", path: dir, role: "" }];
    const result = scanDesignFiles(repos);
    expect(result[0]!.designFiles).toBeUndefined();
  });

  it("finds .pen files at root and nested paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-"));
    writeFileSync(join(dir, "root.pen"), "");
    mkdirSync(join(dir, "design"), { recursive: true });
    writeFileSync(join(dir, "design", "login.pen"), "");
    const repos = [{ name: "r1", path: dir, role: "" }];
    const result = scanDesignFiles(repos);
    expect(result[0]!.designFiles?.sort()).toEqual(["design/login.pen", "root.pen"]);
  });

  it("ignores node_modules and .git", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-"));
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "stale.pen"), "");
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "in-git.pen"), "");
    writeFileSync(join(dir, "kept.pen"), "");
    const repos = [{ name: "r1", path: dir, role: "" }];
    const result = scanDesignFiles(repos);
    expect(result[0]!.designFiles).toEqual(["kept.pen"]);
  });
});
