import { z } from "zod";

export const DifficultyEnum = z.enum([
  "trivial",
  "small",
  "medium",
  "large",
  "xlarge",
]);
export type Difficulty = z.infer<typeof DifficultyEnum>;

export const TriageSchema = z.object({
  difficulty: DifficultyEnum,
  selectedAgents: z.array(z.string().min(1)).min(1),
  rationale: z.string().optional(),
});
export type Triage = z.infer<typeof TriageSchema>;

export const SUB_TASK_COUNT_BY_DIFFICULTY: Record<Difficulty, string> = {
  trivial: "exactly 1 sub-task",
  small: "1–2 sub-tasks",
  medium: "2–3 sub-tasks",
  large: "3–5 sub-tasks",
  xlarge: "5–7 sub-tasks",
};

export function buildTriagePrompt(opts: {
  task: string;
  cwd: string;
  roster: Array<{ name: string; role?: string; description?: string }>;
}): string {
  const rosterText = opts.roster
    .map((w) => {
      const label = w.role ? `${w.name} (role: ${w.role})` : w.name;
      return `- ${label}${w.description ? ` — ${w.description}` : ""}`;
    })
    .join("\n");
  return `
You are operating in TRIAGE mode. Before any work is decomposed, classify how big the task is and pick the smallest set of agents that can accomplish it well.

# User task
${opts.task}

# Working directory
${opts.cwd}

# Full agent roster (pick any subset)
${rosterText}

# Difficulty ladder
- **trivial**: typo / one-line / obvious rename. A human would finish in under a minute.
- **small**: single-file feature or clear bug fix. <15 min of focused work.
- **medium**: multi-file change or moderate refactor. 15–60 min.
- **large**: cross-module change or new subsystem. 1–4 hours.
- **xlarge**: major feature needing research + design + impl + tests + docs.

# Agent selection rules
- Pick the **smallest set** that can do the job well.
- Typical counts: trivial/small → 1–2 agents; medium → 2–4; large → 3–6; xlarge → up to 8.
- Include an agent only if its charter clearly maps to work the task requires. Do not include "just in case" — the planner can only assign among the agents you select.
- If the task is UI-visible, include a browser / E2E agent. If it touches infra, include the DevOps agent. If there's a failing test or broken state, include a debugger. Otherwise leave them out.

# Required output
Your FINAL assistant message MUST end with a single fenced \`\`\`json\`\`\` code block matching this schema (no prose after it):

\`\`\`json
{
  "difficulty": "trivial | small | medium | large | xlarge",
  "selectedAgents": ["Name1", "Name2", ...],
  "rationale": "one short paragraph explaining difficulty assessment and why each agent made the cut"
}
\`\`\`
`.trim();
}

export const SubTaskPlanSchema = z.object({
  title: z.string().min(1).describe("Short imperative title for the sub-task"),
  prompt: z
    .string()
    .min(1)
    .describe("Detailed instructions that will be sent to the assigned worker agent"),
  assignedAgent: z
    .string()
    .min(1)
    .describe("Name of the worker agent to execute this sub-task; must be in the provided roster"),
  rationale: z
    .string()
    .optional()
    .describe("One-sentence justification for the agent selection and the sub-task scope"),
});

export const TaskPlanSchema = z.object({
  overallStrategy: z
    .string()
    .describe("One-paragraph explanation of the decomposition approach"),
  subTasks: z.array(SubTaskPlanSchema).min(1).max(8),
});

export type SubTaskPlan = z.infer<typeof SubTaskPlanSchema>;
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export const SUMMARY_SCHEMA = {
  type: "object",
  required: ["summary"],
  properties: {
    summary: {
      type: "string",
      description:
        "Full markdown summary of the team run: what was accomplished, what failed, follow-ups",
    },
    status: {
      type: "string",
      enum: ["success", "partial", "failure"],
      description: "Overall status based on all agent outcomes",
    },
  },
} as const;

export const PLAN_JSON_SCHEMA = {
  type: "object",
  required: ["overallStrategy", "subTasks"],
  properties: {
    overallStrategy: { type: "string" },
    subTasks: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        required: ["title", "prompt", "assignedAgent"],
        properties: {
          title: { type: "string" },
          prompt: { type: "string" },
          assignedAgent: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
  },
} as const;

export function buildPlannerPrompt(opts: {
  task: string;
  cwd: string;
  workerRoster: Array<{ name: string; role?: string; description?: string }>;
  difficulty?: Difficulty;
  triageRationale?: string;
}): string {
  const roster = opts.workerRoster
    .map((w) => {
      const label = w.role ? `${w.name} (role: ${w.role})` : w.name;
      return `- ${label}${w.description ? ` — ${w.description}` : ""}`;
    })
    .join("\n");
  const difficultyLine = opts.difficulty
    ? `\n\n# Difficulty (from triage)\n${opts.difficulty} — aim for ${SUB_TASK_COUNT_BY_DIFFICULTY[opts.difficulty]}.`
    : "";
  const triageLine = opts.triageRationale
    ? `\n\n# Triage rationale\n${opts.triageRationale}`
    : "";
  return `
You are the planner for a team of coding agents. Decompose the user's task into focused sub-tasks and choose which worker agent is best suited for each.${difficultyLine}${triageLine}

# User task
${opts.task}

# Working directory
${opts.cwd}

# Available worker agents (pick each "assignedAgent" from this exact list)
${roster}

# Required output
Your FINAL assistant message MUST end with a single fenced JSON code block matching the schema below. No other prose after the block. Keep the sub-task count aligned with the difficulty guidance above. Each sub-task's "prompt" must be self-contained (the worker will not see this planning conversation).

Schema:
\`\`\`json
{
  "overallStrategy": "string (one paragraph)",
  "subTasks": [
    {
      "title": "string (short imperative)",
      "prompt": "string (detailed instructions for the worker)",
      "assignedAgent": "string (must be exactly one of the roster names above)",
      "rationale": "string (optional; one sentence)"
    }
  ]
}
\`\`\`

Do not assign agents that are not in the roster. Do not wrap the JSON in any additional keys. Emit the block verbatim as your closing message.
`.trim();
}

export function buildSummaryPrompt(opts: {
  task: string;
  cwd: string;
  subTaskReports: Array<{
    title: string;
    agent: string;
    role?: string;
    status: string;
    report: string;
  }>;
}): string {
  const sections = opts.subTaskReports
    .map(
      (r, i) => `
## Sub-task ${i + 1}: ${r.title}
- Agent: ${r.role ? `${r.agent} (role: ${r.role})` : r.agent}
- Status: ${r.status}

### Report
${r.report || "(no report captured)"}
`.trim(),
    )
    .join("\n\n");

  return `
You are the summarizer for a coding-agent team. Produce a concise, faithful markdown summary of the team run based on each agent's report.

# Original user task
${opts.task}

# Working directory
${opts.cwd}

# Per-agent reports
${sections}

# Required output
Your FINAL assistant message MUST end with a single fenced JSON code block matching the schema below.

Schema:
\`\`\`json
{
  "summary": "string (full markdown: headline, 'What was done' section, 'Follow-ups / risks' section)",
  "status": "success | partial | failure"
}
\`\`\`

Do not output any prose after the JSON block.
`.trim();
}
