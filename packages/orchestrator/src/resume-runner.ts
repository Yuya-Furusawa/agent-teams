import type { SubTaskRow } from "@agent-teams/storage";

export type ResumeStage = "triage" | "workers" | "refix-planning" | "summarizer" | "noop";

/**
 * Decide which phase to re-enter for a paused / failed task. `summaryExists`
 * means `summary.md` is present on disk for the task. `roleOf` returns the
 * role for an agent name (or undefined if unknown — treated as non-reviewer).
 */
export function determineResumeStage(
  subTasks: SubTaskRow[],
  summaryExists: boolean,
  roleOf: (agent: string) => string | undefined,
): ResumeStage {
  if (subTasks.length === 0) return "triage";

  const hasIncomplete = subTasks.some((s) => s.status !== "completed");
  if (hasIncomplete) return "workers";

  const round1 = subTasks.filter((s) => s.round === 1);
  const round2 = subTasks.filter((s) => s.round === 2);
  const round1HadReviewers = round1.some((s) => (roleOf(s.assigned_agent) ?? "").endsWith("-reviewer"));

  if (round2.length === 0 && round1HadReviewers) return "refix-planning";
  if (!summaryExists) return "summarizer";
  return "noop";
}
