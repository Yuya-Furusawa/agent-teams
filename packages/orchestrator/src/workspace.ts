import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { workspaceFile, workspacesDir } from "@agent-teams/storage";
import { globSync } from "glob";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { PbiConfigSchema } from "./team.js";

export const RepoSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  role: z.string().optional(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const WorkspaceSchema = z.object({
  name: z.string().min(1),
  repos: z.array(RepoSchema).min(1),
  pbi: PbiConfigSchema.optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export function loadWorkspace(name: string): Workspace {
  const path = workspaceFile(name);
  if (!existsSync(path)) {
    throw new Error(`workspace "${name}" not found at ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  const data = parseYaml(raw) as unknown;
  const parsed = WorkspaceSchema.parse(data);

  const baseDir = dirname(path);
  const seen = new Set<string>();
  const repos = parsed.repos.map((r) => {
    if (seen.has(r.name)) {
      throw new Error(`duplicate repo name "${r.name}" in workspace "${name}"`);
    }
    seen.add(r.name);
    const absPath = isAbsolute(r.path) ? r.path : resolve(baseDir, r.path);
    if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
      throw new Error(
        `repo "${r.name}" path does not exist or is not a directory: ${absPath}`,
      );
    }
    return { ...r, path: absPath };
  });
  return { ...parsed, repos };
}

export function listWorkspaces(): string[] {
  const dir = workspacesDir();
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""))
    .sort();
}

export function workspaceRepoByName(
  workspace: Workspace,
  name: string | undefined | null,
): Repo | undefined {
  if (!name) return undefined;
  return workspace.repos.find((r) => r.name === name);
}

export interface RepoWithDesign extends Repo {
  /** Relative paths (from `repo.path`) of every `.pen` file found, omitted if none. */
  designFiles?: string[];
}

const DESIGN_SCAN_IGNORE = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  ".next/**",
  ".turbo/**",
  "target/**",
  "vendor/**",
  "out/**",
];

export function scanDesignFiles(repos: Repo[]): RepoWithDesign[] {
  return repos.map((r) => {
    const files = globSync("**/*.pen", {
      cwd: r.path,
      ignore: DESIGN_SCAN_IGNORE,
      nodir: true,
    });
    return files.length > 0 ? { ...r, designFiles: files.sort() } : r;
  });
}
