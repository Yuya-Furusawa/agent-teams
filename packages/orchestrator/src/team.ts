import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { AgentRegistry } from "./agent-registry.js";

export const PbiConfigSchema = z.object({
  vault: z.string().min(1),
  dir: z.string().default("PBIs"),
});

export type PbiConfig = z.infer<typeof PbiConfigSchema>;

export const TeamSchema = z.object({
  name: z.string().min(1),
  planner: z.string().min(1),
  workers: z.array(z.string().min(1)).min(1),
  defaults: z
    .object({
      model: z.string().optional(),
      maxParallel: z.number().int().positive().optional(),
    })
    .optional(),
  pbi: PbiConfigSchema.optional(),
});

export type Team = z.infer<typeof TeamSchema>;

export function loadTeam(path: string): Team {
  if (!existsSync(path)) {
    throw new Error(`team config not found at ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  const data = parseYaml(raw) as unknown;
  return TeamSchema.parse(data);
}

// Names that Claude Code ships out of the box; accepted without a registry entry.
const BUILT_IN_AGENTS = new Set([
  "general-purpose",
  "Explore",
  "Plan",
  "statusline-setup",
]);

export function validateTeamAgainstRegistry(team: Team, registry: AgentRegistry): void {
  const available = new Set([...Object.keys(registry), ...BUILT_IN_AGENTS]);
  const missing: string[] = [];
  if (!available.has(team.planner)) missing.push(team.planner);
  for (const w of team.workers) {
    if (!available.has(w)) missing.push(w);
  }
  if (missing.length > 0) {
    throw new Error(
      `team references agents not found in the registry or Claude built-ins: ${[...new Set(missing)].join(", ")}. known: ${[...available].sort().join(", ")}`,
    );
  }
}
