import { z } from "zod";

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
  workerRoster: Array<{ name: string; description?: string }>;
}): string {
  const roster = opts.workerRoster
    .map((w) => `- ${w.name}${w.description ? `: ${w.description}` : ""}`)
    .join("\n");
  return `
You are the planner for a team of coding agents. Decompose the user's task into 2–4 focused sub-tasks, then choose which worker agent is best suited for each.

# User task
${opts.task}

# Working directory
${opts.cwd}

# Available worker agents (pick each "assignedAgent" from this exact list)
${roster}

# Required output
Your FINAL assistant message MUST end with a single fenced JSON code block matching the schema below. No other prose after the block. Use at most 4 sub-tasks. Each sub-task's "prompt" must be self-contained (the worker will not see this planning conversation).

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
  subTaskReports: Array<{ title: string; agent: string; status: string; report: string }>;
}): string {
  const sections = opts.subTaskReports
    .map(
      (r, i) => `
## Sub-task ${i + 1}: ${r.title}
- Agent: ${r.agent}
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
