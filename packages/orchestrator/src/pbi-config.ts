import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { PbiConfig } from "./team.js";
import { PbiConfigSchema } from "./team.js";
import type { Workspace } from "./workspace.js";

export interface LoadPbiConfigOptions {
  cwd?: string;
  workspace?: Workspace;
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function fromYamlPbi(raw: unknown): PbiConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!obj.pbi) return null;
  const parsed = PbiConfigSchema.parse(obj.pbi);
  return { ...parsed, vault: expandHome(parsed.vault) };
}

function fromEnv(): PbiConfig | null {
  const vault = process.env.AGENT_TEAMS_OBSIDIAN_VAULT;
  if (!vault) return null;
  const dir = process.env.AGENT_TEAMS_OBSIDIAN_PBI_DIR ?? "PBIs";
  return { vault: expandHome(vault), dir };
}

export function loadPbiConfig(opts: LoadPbiConfigOptions): PbiConfig {
  // workspace mode: read ONLY the workspace's pbi block (per spec). Do not look at repos[0].
  if (opts.workspace) {
    const wsPbi = opts.workspace.pbi;
    if (wsPbi) return { ...wsPbi, vault: expandHome(wsPbi.vault) };
    const env = fromEnv();
    if (env) return env;
    throw new Error(
      `Configure pbi.vault in workspaces/${opts.workspace.name}.yaml or set AGENT_TEAMS_OBSIDIAN_VAULT.`,
    );
  }

  // single-repo mode
  const cwd = opts.cwd ?? process.cwd();
  const yamlPath = join(cwd, "agent-team.yaml");
  if (existsSync(yamlPath)) {
    const raw = parseYaml(readFileSync(yamlPath, "utf8"));
    const fromYaml = fromYamlPbi(raw);
    if (fromYaml) return fromYaml;
  }
  const env = fromEnv();
  if (env) return env;
  throw new Error(
    `Configure pbi.vault in agent-team.yaml or set AGENT_TEAMS_OBSIDIAN_VAULT.`,
  );
}
