import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rotateBackup } from "./files.js";

describe("rotateBackup", () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "agent-teams-files-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("renames the source file to <name>.backup-<ts> and returns the new path", () => {
    const src = join(dir, "events.jsonl");
    writeFileSync(src, "line1\n", "utf8");
    const result = rotateBackup(src, 3);
    expect(existsSync(src)).toBe(false);
    expect(result).toMatch(/events\.jsonl\.backup-\d+$/);
    expect(existsSync(result!)).toBe(true);
  });

  it("returns null when the source file does not exist (no-op)", () => {
    const src = join(dir, "events.jsonl");
    expect(rotateBackup(src, 3)).toBeNull();
  });

  it("keeps at most `keep` backups, deleting the oldest", async () => {
    const src = join(dir, "events.jsonl");
    for (let i = 0; i < 4; i++) {
      writeFileSync(src, `gen${i}`, "utf8");
      rotateBackup(src, 3);
      // ensure distinct timestamps even on fast systems
      await new Promise((r) => setTimeout(r, 5));
    }
    const remaining = readdirSync(dir).filter((f) => f.startsWith("events.jsonl.backup-"));
    expect(remaining).toHaveLength(3);
  });
});
