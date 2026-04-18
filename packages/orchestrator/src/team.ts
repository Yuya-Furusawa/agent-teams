import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

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
