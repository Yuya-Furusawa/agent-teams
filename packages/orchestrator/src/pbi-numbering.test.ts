import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nextPbiNumber, listPbiFiles, resolvePbiPath } from "./pbi-numbering.js";

function tmpVault(filenames: string[]): { vault: string; dir: string } {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const dir = "PBIs";
  mkdirSync(join(vault, dir), { recursive: true });
  for (const f of filenames) writeFileSync(join(vault, dir, f), "x", "utf8");
  return { vault, dir };
}

describe("nextPbiNumber", () => {
  it("returns 1 for empty vault dir", () => {
    const { vault, dir } = tmpVault([]);
    expect(nextPbiNumber({ vault, dir })).toBe(1);
  });
  it("returns max+1 considering only valid filenames", () => {
    const { vault, dir } = tmpVault(["PBI-001-a.md", "PBI-005-b.md", "PBI-2-x.md", "README.md"]);
    expect(nextPbiNumber({ vault, dir })).toBe(6);
  });
  it("throws if vault dir does not exist", () => {
    expect(() => nextPbiNumber({ vault: "/nope/nope", dir: "PBIs" })).toThrow();
  });
});

describe("resolvePbiPath", () => {
  it("returns the unique match", () => {
    const { vault, dir } = tmpVault(["PBI-042-foo.md", "PBI-001-bar.md"]);
    expect(resolvePbiPath({ vault, dir }, 42)).toBe(join(vault, dir, "PBI-042-foo.md"));
  });
  it("throws when 0 matches", () => {
    const { vault, dir } = tmpVault(["PBI-001-bar.md"]);
    expect(() => resolvePbiPath({ vault, dir }, 42)).toThrow(/PBI-042 not found/);
  });
  it("throws when >1 matches", () => {
    const { vault, dir } = tmpVault(["PBI-042-a.md", "PBI-042-b.md"]);
    expect(() => resolvePbiPath({ vault, dir }, 42)).toThrow(/multiple PBI-042/);
  });
});
