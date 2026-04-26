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
  trivial: "exactly 1 sub-task (reviewers usually not needed)",
  small: "2–4 sub-tasks total (1–2 core + 1–2 reviewers)",
  medium: "3–6 sub-tasks total (2–3 core + 2–3 reviewers)",
  large: "5–9 sub-tasks total (3–5 core + 3–4 reviewers)",
  xlarge: "8–12 sub-tasks total (5–7 core + 3–5 reviewers)",
};

export function buildTriagePrompt(opts: {
  task: string;
  cwd: string;
  roster: Array<{ name: string; role?: string; description?: string }>;
  repos?: RepoInfo[];
}): string {
  const rosterText = opts.roster
    .map((w) => {
      const label = w.role ? `${w.name} (role: ${w.role})` : w.name;
      return `- ${label}${w.description ? ` — ${w.description}` : ""}`;
    })
    .join("\n");
  const reposBlock = reposSection(opts.repos);
  return `
You are operating in TRIAGE mode. Before any work is decomposed, classify how big the task is and pick the smallest set of agents that can accomplish it well.

# User task
${opts.task}

# Working directory
${opts.cwd}${reposBlock}

# Full agent roster (pick any subset)
${rosterText}

# Difficulty ladder
- **trivial**: typo / one-line / obvious rename. A human would finish in under a minute.
- **small**: single-file feature or clear bug fix. <15 min of focused work.
- **medium**: multi-file change or moderate refactor. 15–60 min.
- **large**: cross-module change or new subsystem. 1–4 hours.
- **xlarge**: major feature needing research + design + impl + tests + docs.

# Agent selection rules (non-reviewers)
- For everything except reviewers, pick the **smallest set** that can do the job well.
- Typical core-agent counts: trivial/small → 1–2; medium → 2–3; large → 3–5; xlarge → up to 7.
- Include a core agent only if its charter clearly maps to work the task requires. Do not include "just in case" — the planner can only assign among the agents you select.
- If the task is UI-visible, include a browser / E2E agent. If it touches infra, include the DevOps agent. If there's a failing test or broken state, include a debugger. Otherwise leave them out.

# Reviewer selection policy (diversity-first, override the "smallest set" rule)
Reviewers run in parallel after the implementer(s) and are cheap to add (no coordination cost), so **select multiple reviewers with distinct lenses by default** whenever the task will modify executable code or configuration. The roster includes up to five reviewers:
- **Iris** (general correctness / fit)
- **Haru** (maintainability — readability, coupling, change surface)
- **Vale** (security — inputs, auth, secrets, crypto, SSRF, deps)
- **Kiri** (simplicity — dead code, redundancy, over-abstraction)
- **Tess** (test review — coverage vs. behavior, assertion strength, flakiness)

Rules:
- **Vale is mandatory** for any task that touches executable code, configuration, dependency manifests, CI/CD, infra-as-code, auth/permission flows, request handling, data storage, crypto, or third-party integrations. The ONLY reason to omit Vale is that the task is unambiguously non-security — e.g. prose-only edits to README / docs / comments, screenshot updates, typo fixes in user-facing strings, changelog entries. If in doubt, include Vale.
- **Include at least 2 reviewers total** whenever any implementer is selected. For medium+ tasks, aim for 3–4 diverse reviewers. Do not include all five unless the task genuinely spans all their concerns.
- Pick reviewers whose lenses actually map to the change:
  - Touches tests or asks for test coverage → always include **Tess**.
  - Touches module boundaries, public APIs, or core modules → include **Haru**.
  - Refactor / cleanup / removal task → include **Kiri** (often as the primary reviewer).
  - Security-adjacent task (auth, crypto, parsing untrusted input, new dependencies) → **Vale** is required AND should be flagged prominently in the rationale.
- For docs-only tasks: reviewers are usually skipped entirely (Lin alone is fine). Do not force Vale onto a pure prose change.
- For trivial tasks: reviewers may be skipped. If a trivial task touches security-sensitive code, upgrade difficulty to "small" and include Vale.

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
  id: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9_-]+$/)
    .describe(
      "Plan-local identifier for this sub-task. Other sub-tasks in the same plan reference this via dependsOn. Must be unique within the plan and contain only letters, digits, underscore, or hyphen.",
    ),
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
  targetRepo: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Name of the primary repo this sub-task operates in. Required in workspace mode (must match one of the repo names provided); omit or use null in single-repo / PBI mode.",
    ),
  dependsOn: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Ids of sibling sub-tasks that must complete before this one starts. Empty/absent means the sub-task has no prerequisites and runs in the initial layer.",
    ),
});

export const TaskPlanSchema = z.object({
  overallStrategy: z
    .string()
    .describe("One-paragraph explanation of the decomposition approach"),
  subTasks: z.array(SubTaskPlanSchema).min(1).max(12),
});

export type SubTaskPlan = z.infer<typeof SubTaskPlanSchema>;
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

/**
 * Refix plan. Like TaskPlanSchema but allows an empty subTasks array — Sage
 * returns an empty plan when round 1 produced no in-scope findings.
 * overallStrategy remains required so the reason-for-skip flows to summary.
 */
export const RefixPlanSchema = z.object({
  overallStrategy: z
    .string()
    .min(1)
    .describe("One paragraph: either the refix strategy, or why refix is unnecessary"),
  subTasks: z.array(SubTaskPlanSchema).min(0).max(12),
});
export type RefixPlan = z.infer<typeof RefixPlanSchema>;

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
      maxItems: 12,
      items: {
        type: "object",
        required: ["id", "title", "prompt", "assignedAgent"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          prompt: { type: "string" },
          assignedAgent: { type: "string" },
          rationale: { type: "string" },
          targetRepo: { type: "string" },
          dependsOn: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export const REFIX_PLAN_JSON_SCHEMA = {
  type: "object",
  required: ["overallStrategy", "subTasks"],
  properties: {
    overallStrategy: { type: "string" },
    subTasks: {
      type: "array",
      minItems: 0,
      maxItems: 12,
      items: PLAN_JSON_SCHEMA.properties.subTasks.items,
    },
  },
} as const;

export interface RepoInfo {
  name: string;
  path: string;
  role?: string;
  designFiles?: string[];
}

function reposSection(repos: RepoInfo[] | undefined): string {
  if (!repos || repos.length === 0) return "";
  const list = repos
    .map((r) => {
      const role = r.role ? ` — ${r.role}` : "";
      const design =
        r.designFiles && r.designFiles.length > 0
          ? ` — design files: ${r.designFiles.join(", ")}`
          : "";
      return `- ${r.name}: ${r.path}${role}${design}`;
    })
    .join("\n");
  return `\n\n# Repos (workspace mode)\n${list}`;
}

export function buildPlannerPrompt(opts: {
  task: string;
  cwd: string;
  workerRoster: Array<{ name: string; role?: string; description?: string }>;
  difficulty?: Difficulty;
  triageRationale?: string;
  repos?: RepoInfo[];
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
  const reposBlock = reposSection(opts.repos);
  const targetRepoInstruction = opts.repos && opts.repos.length > 0
    ? `\n\n# Multi-repo routing\nThis run spans multiple repos. For each sub-task you MUST set "targetRepo" to exactly one of the repo names listed above. The worker will be spawned with that repo as its working directory and will have read-only awareness of the peer repos.`
    : "";
  const schemaTargetRepoField = opts.repos && opts.repos.length > 0
    ? `,\n      "targetRepo": "string (exactly one repo name from the Repos list — REQUIRED in workspace mode)"`
    : "";
  return `
You are the planner for a team of coding agents. Decompose the user's task into focused sub-tasks and choose which worker agent is best suited for each.${difficultyLine}${triageLine}

# User task
${opts.task}

# Working directory
${opts.cwd}${reposBlock}${targetRepoInstruction}

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
      "id": "string (short unique slug, letters/digits/underscore/hyphen only — referenced from dependsOn)",
      "title": "string (short imperative)",
      "prompt": "string (detailed instructions for the worker)",
      "assignedAgent": "string (must be exactly one of the roster names above)",
      "rationale": "string (optional; one sentence)",
      "dependsOn": ["string (optional; ids of sibling sub-tasks that must finish first)"]${schemaTargetRepoField}
    }
  ]
}
\`\`\`

# Ordering via dependsOn
- Sub-tasks with no \`dependsOn\` run in the initial layer (possibly in parallel).
- If a sub-task consumes another's output (e.g. a code-reviewer reads an implementer's diff, a qa-engineer tests an implementation, a docs-writer documents a shipped feature), put the prerequisite sub-task ids in \`dependsOn\`.
- Multiple reviewers of the same implementation SHARE the same \`dependsOn\` (they run in parallel after the implementation). Only chain reviewers when a later reviewer must see the earlier reviewer's feedback.
- Never create cycles. Every id in \`dependsOn\` must reference another sub-task in this same plan.

# Reviewer fan-out
- If triage selected multiple reviewer agents (Iris / Haru / Vale / Kiri / Tess), give each its own sub-task. Do not merge reviewers — the whole point is that each applies a distinct lens.
- All reviewer sub-tasks for the same implementation share the same \`dependsOn\` (the implementer's ids) so they run in parallel.
- Security reviewer (**Vale**) is mandatory whenever any implementation / infra / dependency sub-task exists — include it even if the triage roster happens to omit it (in that rare case, still assign Vale; planner-assigned agents must be in the triage roster, so if Vale is missing, report this by selecting the closest available reviewer and noting the gap in \`rationale\`). Exception: docs-only / prose-only runs.
- Each reviewer sub-task's \`prompt\` should be tailored to that reviewer's charter — do not copy-paste the same prompt across reviewers. Mention the specific files / behaviors to focus on from the implementation.

Do not assign agents that are not in the roster. Do not wrap the JSON in any additional keys. Emit the block verbatim as your closing message.
`.trim();
}

export interface Round1ReportInput {
  subTaskId: string;
  title: string;
  assignedAgent: string;
  role?: string;
  status: string;
  report: string;
  targetRepo?: string | null;
}

export interface OriginalPlanEntry {
  id: string;
  title: string;
  prompt: string;
  assignedAgent: string;
  targetRepo?: string | null;
}

export function buildRefixPlannerPrompt(opts: {
  task: string;
  cwd: string;
  round1Reports: Round1ReportInput[];
  originalPlan: OriginalPlanEntry[];
  repos?: RepoInfo[];
}): string {
  const reportSections = opts.round1Reports
    .map(
      (r, i) => `
## Round 1 sub-task ${i + 1}: ${r.title}
- id: ${r.subTaskId}
- agent: ${r.role ? `${r.assignedAgent} (role: ${r.role})` : r.assignedAgent}
- status: ${r.status}${r.targetRepo ? `\n- targetRepo: ${r.targetRepo}` : ""}

### Report
${r.report || "(no report captured)"}
`.trim(),
    )
    .join("\n\n");

  const implementerMap = opts.originalPlan
    .map((p) => `- ${p.id} → ${p.assignedAgent}${p.targetRepo ? ` (${p.targetRepo})` : ""}: ${p.title}`)
    .join("\n");

  const reposBlock = reposSection(opts.repos);
  const schemaTargetRepoField = opts.repos && opts.repos.length > 0
    ? `,\n      "targetRepo": "string (repo name; inherit from the original implementer's sub-task)"`
    : "";

  return `
You are the planner for a team of coding agents, operating in **refix-planning mode**. The round-1 DAG (implementers + reviewers) has completed. Decide whether a refix round is needed and, if so, emit the refix sub-tasks.

# Scope rules
- In-scope for refix: every must-fix finding (all reviewers), plus every nice-to-fix finding raised by Vale (security).
- Out-of-scope: nit, nice-to-fix from non-Vale reviewers.
- If Vale is not present in round 1 reports, the Vale escalation rule is a no-op (treat scope as must-fix only).
- If no in-scope findings exist, emit an empty \`subTasks\` array. You MUST still provide a non-empty \`overallStrategy\` explaining why refix is unnecessary.

# Assignment rules
- Each refix sub-task's \`assignedAgent\` MUST equal the ORIGINAL implementer's name (see mapping below). Do not reassign to a different implementer.
- Group all in-scope findings targeting the same implementer into a single refix sub-task.
- Each refix sub-task inherits the \`targetRepo\` of the original implementer's sub-task (relevant in workspace mode).
- For each reviewer who raised in-scope findings, emit exactly ONE re-review sub-task. If that reviewer had findings against multiple implementers, the re-review sub-task's \`dependsOn\` lists ALL corresponding refix sub-task ids — a single reviewer session re-checks all related refixes.
- Re-review prompts MUST state explicitly: any new must-fix findings raised in round 2 will be deferred to the summary, not fixed in this run.

# User task
${opts.task}

# Working directory
${opts.cwd}${reposBlock}

# Original implementer → sub-task mapping
${implementerMap}

# Round 1 reports
${reportSections}

# Required output
Your FINAL assistant message MUST end with a single fenced \`\`\`json\`\`\` code block matching this schema:

\`\`\`json
{
  "overallStrategy": "string (refix plan or the reason refix is unnecessary)",
  "subTasks": [
    {
      "id": "string (slug unique within this refix plan; referenced by dependsOn)",
      "title": "string",
      "prompt": "string (self-contained; include the original report path, the specific findings to address, and the 'no further refix in round 2' note for re-reviewers)",
      "assignedAgent": "string (original implementer's name for refix; reviewer's name for re-review)",
      "rationale": "string (optional)",
      "dependsOn": ["string (re-review sub-tasks list their refix sub-task ids here)"]${schemaTargetRepoField}
    }
  ]
}
\`\`\`

Emit the JSON block verbatim as your closing message. No prose after the block.
`.trim();
}

export interface ReviewFinding {
  reviewer: string;
  severity: "must-fix" | "nice-to-fix";
  body: string;
}

export function buildRefixWorkerPrompt(opts: {
  originalReportPath: string;
  findings: ReviewFinding[];
  targetRepo?: string;
}): string {
  const grouped = opts.findings.map(
    (f) => `- [${f.severity}] ${f.reviewer}: ${f.body}`,
  );
  return `
# Refix assignment

Your previous work on this sub-task was reviewed. Address the findings below in the same files you modified before.

Original report (for your reference): ${opts.originalReportPath}${opts.targetRepo ? `\nTarget repo: ${opts.targetRepo}` : ""}

## Findings to address (in-scope)
${grouped.join("\n")}

## Rules
- Fix every must-fix finding. Fix every nice-to-fix finding raised by Vale (security).
- Do NOT introduce unrelated changes. Scope is strictly the findings above.
- A re-review will follow this sub-task; it will verify each finding is addressed.
- If a finding is ambiguous or you cannot reproduce it, document your decision in the report under \`## 申し送り / ブロッカー\`.
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
    targetRepo?: string | null;
    round?: number;
  }>;
  refixSkipReason?: string;
  repos?: RepoInfo[];
}): string {
  const sections = opts.subTaskReports
    .map((r, i) => {
      const roundTag = r.round ? ` [round ${r.round}]` : "";
      return `
## Sub-task ${i + 1}${roundTag}: ${r.title}
- Agent: ${r.role ? `${r.agent} (role: ${r.role})` : r.agent}${r.targetRepo ? `\n- Repo: ${r.targetRepo}` : ""}
- Status: ${r.status}

### Report
${r.report || "(no report captured)"}
`.trim();
    })
    .join("\n\n");
  const reposBlock = reposSection(opts.repos);
  const refixSkipBlock = opts.refixSkipReason
    ? `\n\n# Refix phase\nRefix was skipped. Sage's reason: ${opts.refixSkipReason}`
    : "";

  return `
You are the summarizer for a coding-agent team. Produce a concise, faithful markdown summary of the team run based on each agent's report.

**Write the "summary" value in Japanese (日本語)**. Keep file paths, agent names, code identifiers, and command names verbatim in English — only surrounding prose and section headings should be Japanese. Use these Japanese section headings in the markdown body **in this exact order**: \`## つぶやき\`, \`## 概要\`, \`## 実施内容\`, \`## 申し送り / リスク\`. つぶやき must be the very first section after the top-level heading — it is flavor text meant to be read before the substance.

**つぶやき section**: For each sub-task, extract the agent's \`## つぶやき\` line from their report (a short tweet-style quip in character) and render it as a blockquote in the summary, attributed to the agent. Example:
\`\`\`
## つぶやき
> テスト先に書いたら勝ち確。 — Mika
> 型が合えば夜ぐっすり眠れる。 — Aki
\`\`\`
If an agent omitted the つぶやき section, skip that agent silently — do not fabricate quotes. Preserve the agent's wording verbatim (do not paraphrase or translate).

**Rounds**: Sub-tasks are tagged \`[round 1]\` (initial plan) or \`[round 2]\` (refix + re-review). In the \`## 実施内容\` and \`## 申し送り / リスク\` sections, when both rounds exist, describe round 1 first, then the refix round separately so the reader can trace what was fixed. If the refix phase was skipped entirely, note the reason in \`## 概要\`.

# Original user task
${opts.task}

# Working directory
${opts.cwd}${reposBlock}${refixSkipBlock}

# Per-agent reports
${sections}

# Required output
Your FINAL assistant message MUST end with a single fenced JSON code block matching the schema below. The JSON keys ("summary", "status") and the status enum values stay in English; only the markdown text inside the "summary" string is Japanese.

Schema:
\`\`\`json
{
  "summary": "string (日本語の markdown: 見出し + ## つぶやき + ## 概要 + ## 実施内容 + ## 申し送り / リスク — この順序)",
  "status": "success | partial | failure"
}
\`\`\`

Do not output any prose after the JSON block.
`.trim();
}
