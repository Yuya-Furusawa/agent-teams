import type { AgentDefinition, AgentRegistry } from "./agent-registry.js";
import type { Team } from "./team.js";

const DEFAULT_WORKSPACE_PLANNER = "Sage";
const DEFAULT_WORKSPACE_MODEL = "claude-opus-4-7";
const DEFAULT_WORKSPACE_MAX_PARALLEL = 3;

export interface AgentInstance {
  name: string;
  role?: string;
  personality?: string;
  description: string;
  prompt: string;
  isBuiltIn: boolean;
}

const BUILT_IN_AGENTS = new Set([
  "general-purpose",
  "Explore",
  "Plan",
  "statusline-setup",
]);

export function resolveTeam(team: Team, registry: AgentRegistry): AgentInstance[] {
  const seen = new Set<string>();
  const instances: AgentInstance[] = [];
  for (const name of team.workers) {
    if (seen.has(name)) {
      throw new Error(`duplicate worker "${name}" in team "${team.name}"`);
    }
    seen.add(name);
    instances.push(instanceOf(name, registry));
  }
  return instances;
}

export function resolvePlannerInstance(
  team: Team,
  registry: AgentRegistry,
): AgentInstance {
  return instanceOf(team.planner, registry);
}

function instanceOf(name: string, registry: AgentRegistry): AgentInstance {
  const def: AgentDefinition | undefined = registry[name];
  if (def) {
    return {
      name: def.name,
      role: def.role,
      personality: def.personality,
      description: def.description,
      prompt: def.prompt,
      isBuiltIn: false,
    };
  }
  if (BUILT_IN_AGENTS.has(name)) {
    return {
      name,
      description: "",
      prompt: "",
      isBuiltIn: true,
    };
  }
  throw new Error(
    `agent "${name}" not found (not in registry and not a Claude built-in)`,
  );
}

export function buildInstanceInlineAgents(
  instances: AgentInstance[],
): Record<string, { description: string; prompt: string }> {
  const map: Record<string, { description: string; prompt: string }> = {};
  for (const inst of instances) {
    if (inst.isBuiltIn) continue;
    map[inst.name] = {
      description: inst.description,
      prompt: buildInstancePrompt(inst),
    };
  }
  return map;
}

export function resolveWorkspaceTeam(
  workspaceName: string,
  registry: AgentRegistry,
): Team {
  const plannerName = registry[DEFAULT_WORKSPACE_PLANNER]
    ? DEFAULT_WORKSPACE_PLANNER
    : findFirstPlannerRole(registry) ?? DEFAULT_WORKSPACE_PLANNER;
  const workers = Object.values(registry)
    .filter((def) => def.name !== plannerName)
    .map((def) => def.name)
    .sort();
  if (workers.length === 0) {
    throw new Error(
      `workspace "${workspaceName}" has no worker agents available (registry is empty after excluding planner "${plannerName}")`,
    );
  }
  return {
    name: `workspace:${workspaceName}`,
    planner: plannerName,
    workers,
    defaults: {
      model: DEFAULT_WORKSPACE_MODEL,
      maxParallel: DEFAULT_WORKSPACE_MAX_PARALLEL,
    },
  };
}

function findFirstPlannerRole(registry: AgentRegistry): string | undefined {
  for (const def of Object.values(registry)) {
    if (def.role === "planner") return def.name;
  }
  return undefined;
}

function buildInstancePrompt(inst: AgentInstance): string {
  const roleFragment = inst.role ? ` Your role on the team is "${inst.role}".` : "";
  const identity = `You are ${inst.name}, a member of a coordinated coding-agent team.${roleFragment} Sign any report you write with your name so teammates and the summarizer can attribute it to you.`;
  const personalityBlock = inst.personality
    ? `\n\n# Personality\n${inst.personality.trim()}`
    : "";
  return `${identity}${personalityBlock}\n\n${inst.prompt}`;
}
