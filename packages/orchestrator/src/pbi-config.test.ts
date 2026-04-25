import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { TeamSchema } from "./team.js";
import { loadPbiConfig } from "./pbi-config.js";

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

describe("loadPbiConfig", () => {
  function tmpRepo(yaml: string): string {
    const dir = mkdtempSync(join(tmpdir(), "agent-teams-test-"));
    writeFileSync(join(dir, "agent-team.yaml"), yaml, "utf8");
    return dir;
  }

  it("reads pbi block from agent-team.yaml in single-repo mode", () => {
    const cwd = tmpRepo(`name: t\nplanner: Sage\nworkers: [Kai]\npbi:\n  vault: /abs/vault\n  dir: PBIs/Inbox\n`);
    const cfg = loadPbiConfig({ cwd });
    expect(cfg.vault).toBe("/abs/vault");
    expect(cfg.dir).toBe("PBIs/Inbox");
  });

  it("falls back to env vars when yaml has no pbi block", () => {
    const cwd = tmpRepo(`name: t\nplanner: Sage\nworkers: [Kai]\n`);
    const prevVault = process.env.AGENT_TEAMS_OBSIDIAN_VAULT;
    const prevDir = process.env.AGENT_TEAMS_OBSIDIAN_PBI_DIR;
    process.env.AGENT_TEAMS_OBSIDIAN_VAULT = "/env/vault";
    process.env.AGENT_TEAMS_OBSIDIAN_PBI_DIR = "Inbox";
    try {
      const cfg = loadPbiConfig({ cwd });
      expect(cfg.vault).toBe("/env/vault");
      expect(cfg.dir).toBe("Inbox");
    } finally {
      process.env.AGENT_TEAMS_OBSIDIAN_VAULT = prevVault;
      process.env.AGENT_TEAMS_OBSIDIAN_PBI_DIR = prevDir;
    }
  });

  it("env dir defaults to 'PBIs' when only vault env is set", () => {
    const cwd = tmpRepo(`name: t\nplanner: Sage\nworkers: [Kai]\n`);
    const prevVault = process.env.AGENT_TEAMS_OBSIDIAN_VAULT;
    const prevDir = process.env.AGENT_TEAMS_OBSIDIAN_PBI_DIR;
    process.env.AGENT_TEAMS_OBSIDIAN_VAULT = "/env/vault";
    delete process.env.AGENT_TEAMS_OBSIDIAN_PBI_DIR;
    try {
      const cfg = loadPbiConfig({ cwd });
      expect(cfg.dir).toBe("PBIs");
    } finally {
      process.env.AGENT_TEAMS_OBSIDIAN_VAULT = prevVault;
      process.env.AGENT_TEAMS_OBSIDIAN_PBI_DIR = prevDir;
    }
  });

  it("expands ~ in vault path", () => {
    const cwd = tmpRepo(`name: t\nplanner: Sage\nworkers: [Kai]\npbi:\n  vault: ~/MyVault\n`);
    const cfg = loadPbiConfig({ cwd });
    expect(cfg.vault).toBe(join(homedir(), "MyVault"));
  });

  it("throws when no yaml block and no env", () => {
    const cwd = tmpRepo(`name: t\nplanner: Sage\nworkers: [Kai]\n`);
    const prev = process.env.AGENT_TEAMS_OBSIDIAN_VAULT;
    delete process.env.AGENT_TEAMS_OBSIDIAN_VAULT;
    try {
      expect(() => loadPbiConfig({ cwd })).toThrow(/Configure pbi.vault/);
    } finally {
      process.env.AGENT_TEAMS_OBSIDIAN_VAULT = prev;
    }
  });

  it("workspace mode reads only the workspace yaml, not repos[0]/agent-team.yaml", () => {
    // 後続 task で workspace ロード経路を作るので、ここでは workspace yaml の参照ロジックのみ確認:
    // workspaceConfig を直接渡せる第二経路を loadPbiConfig が持っていることを確認
    const ws = { name: "w", repos: [{ name: "fe", path: "/whatever" }], pbi: { vault: "/ws/vault", dir: "PBIs" } } as const;
    const cfg = loadPbiConfig({ workspace: ws });
    expect(cfg.vault).toBe("/ws/vault");
    expect(cfg.dir).toBe("PBIs");
  });
});
