import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export interface AgentDefinition {
  name: string;
  role?: string;
  personality?: string;
  description: string;
  prompt: string;
  model?: string;
  tools?: string[];
}

export type AgentRegistry = Record<string, AgentDefinition>;

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// packages/orchestrator/dist/agent-registry.js → up 3 = repo root → + agents
const REPO_DEFAULT_AGENTS_DIR = resolve(MODULE_DIR, "..", "..", "..", "agents");

export function resolveAgentsDir(override?: string): string {
  if (override) return override;
  const envDir = process.env["AGENT_TEAMS_AGENTS_DIR"];
  if (envDir) return envDir;
  return REPO_DEFAULT_AGENTS_DIR;
}

export function loadAgentRegistry(override?: string): AgentRegistry {
  const dir = resolveAgentsDir(override);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return {};
  }
  const registry: AgentRegistry = {};
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    const path = join(dir, entry);
    const raw = readFileSync(path, "utf8");
    const parsed = parseAgentMarkdown(raw);
    if (!parsed) continue;
    if (registry[parsed.name]) {
      throw new Error(
        `duplicate agent name "${parsed.name}" across files in ${dir}. Each agent file must have a unique frontmatter \`name\`.`,
      );
    }
    registry[parsed.name] = parsed;
  }
  return registry;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseAgentMarkdown(raw: string): AgentDefinition | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match || !match[1]) return null;
  const frontmatter = parseYaml(match[1]) as Record<string, unknown> | null;
  const body = (match[2] ?? "").trim();
  if (!frontmatter || typeof frontmatter["name"] !== "string") return null;
  const name = frontmatter["name"];
  const description = typeof frontmatter["description"] === "string"
    ? frontmatter["description"].trim()
    : "";
  if (!body) return null;
  const def: AgentDefinition = { name, description, prompt: body };
  if (typeof frontmatter["role"] === "string") def.role = frontmatter["role"];
  if (typeof frontmatter["personality"] === "string") {
    def.personality = frontmatter["personality"].trim();
  }
  if (typeof frontmatter["model"] === "string") def.model = frontmatter["model"];
  if (Array.isArray(frontmatter["tools"])) {
    def.tools = (frontmatter["tools"] as unknown[]).filter((t): t is string => typeof t === "string");
  }
  return def;
}
