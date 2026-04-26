#!/usr/bin/env node
import { listWorkspaces, loadWorkspace, runTask, runPbiTask, resumePbiTask, resumeTask, resumeDesignTask } from "@agent-teams/orchestrator";
import type { ResumeStage } from "@agent-teams/orchestrator";
import { Command } from "commander";

const program = new Command();

program
  .name("agent-teams")
  .description("Orchestrate multiple Claude Code instances as a coding team")
  .version("0.1.0");

program
  .command("run")
  .description("Run a coding task across the configured agent team")
  .argument("<task...>", "Task description in natural language")
  .option("-t, --team <path>", "Path to team config yaml (defaults to ./agent-team.yaml)")
  .option("-c, --cwd <path>", "Working directory (defaults to current dir)")
  .option("-w, --workspace <name>", "Run across a multi-repo workspace defined in ~/.agent-teams/workspaces/<name>.yaml")
  .action(
    async (
      taskWords: string[],
      options: { team?: string; cwd?: string; workspace?: string },
    ) => {
      const description = taskWords.join(" ").trim();
      if (!description) {
        console.error("error: task description is required");
        process.exit(1);
      }
      if (options.workspace && (options.cwd || options.team)) {
        console.error("error: --workspace cannot be combined with --cwd or --team");
        process.exit(1);
      }
      try {
        const result = await runTask({
          description,
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.team ? { teamPath: options.team } : {}),
          ...(options.workspace ? { workspace: options.workspace } : {}),
        });
        // TASK_ID line is emitted first (and unconditionally) so the parent
        // /team Claude session can grep one line to learn which task it just
        // ran — needed by the design-resume bridge in commands/team.md.
        console.log(`TASK_ID: ${result.taskId}`);
        console.log(`task: ${result.taskId}`);
        console.log(`status: ${result.status}`);
        console.log(`summary: ${result.summaryPath}`);
        // awaiting_user_input means the orchestrator already wrote
        // STATUS / TASK_ID / ITERATION / json block to stdout. Treat as success
        // exit code so the wrapping shell doesn't treat the pause as failure.
        if (result.status === "awaiting_user_input") {
          process.exit(0);
        }
        process.exit(result.status === "completed" ? 0 : 2);
      } catch (err) {
        console.error(`agent-teams run failed: ${(err as Error).message}`);
        process.exit(1);
      }
    },
  );

program
  .command("pbi")
  .description("Generate a Product Backlog Item from a free-form idea (writes to Obsidian Vault)")
  .argument("<idea...>", "PBI idea in natural language")
  .option("-c, --cwd <path>", "Working directory (defaults to current dir)")
  .option("-w, --workspace <name>", "Run in a multi-repo workspace defined in ~/.agent-teams/workspaces/<name>.yaml")
  .action(async (ideaWords: string[], options: { cwd?: string; workspace?: string }) => {
    const idea = ideaWords.join(" ").trim();
    if (!idea) {
      console.error("error: idea is required");
      process.exit(1);
    }
    if (options.workspace && options.cwd) {
      console.error("error: --workspace cannot be combined with --cwd");
      process.exit(1);
    }
    try {
      const result = await runPbiTask({
        idea,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.workspace ? { workspace: options.workspace } : {}),
      });
      if (result.kind === "completed") {
        console.log(`task: ${result.taskId}`);
        console.log(`pbi: PBI-${String(result.pbiId).padStart(3, "0")}`);
        console.log(`path: ${result.pbiPath}`);
        process.exit(0);
      } else {
        console.log(`<<<PBI_QUESTIONS task_id=${result.taskId} pbi_id=${result.pbiId}>>>`);
        console.log(JSON.stringify({ questions: result.questions }, null, 2));
        console.log(`<<<END>>>`);
        process.exit(0);
      }
    } catch (err) {
      console.error(`agent-teams pbi failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("pbi-resume")
  .description("Resume a PBI run that was paused awaiting user input")
  .argument("<task_id>", "task id printed in the previous pbi sentinel block")
  .requiredOption("--answers <json>", "JSON object mapping question id to answer text")
  .action(async (taskId: string, options: { answers: string }) => {
    let answers: Record<string, string>;
    try {
      const parsed = JSON.parse(options.answers) as Record<string, unknown>;
      answers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    } catch (err) {
      console.error(`agent-teams pbi-resume: invalid --answers JSON: ${(err as Error).message}`);
      process.exit(1);
      return;
    }
    try {
      const result = await resumePbiTask({ taskId, answers });
      console.log(`task: ${result.taskId}`);
      console.log(`pbi: PBI-${String(result.pbiId).padStart(3, "0")}`);
      console.log(`path: ${result.pbiPath}`);
      process.exit(0);
    } catch (err) {
      console.error(`agent-teams pbi-resume failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("resume")
  .description("Resume a stuck/failed agent-teams task (skips completed sub-tasks)")
  .argument("[task_id]", "Task id to resume; defaults to the most recent resumable task")
  .option("--from-stage <stage>", "Force a specific stage (triage|workers|refix-planning|summarizer)")
  .option("--force", "Override stale-lock check (use after orchestrator crashes)")
  .action(async (
    taskId: string | undefined,
    options: { fromStage?: string; force?: boolean },
  ) => {
    const validStages: ResumeStage[] = ["triage", "workers", "refix-planning", "summarizer"];
    if (options.fromStage && !validStages.includes(options.fromStage as ResumeStage)) {
      console.error(`error: --from-stage must be one of: ${validStages.join(", ")}`);
      process.exit(1);
    }
    try {
      const result = await resumeTask({
        ...(taskId ? { taskId } : {}),
        ...(options.fromStage ? { fromStage: options.fromStage as ResumeStage } : {}),
        ...(options.force ? { force: true } : {}),
      });
      if (result.multipleCandidates && result.multipleCandidates > 1) {
        console.error(`note: ${result.multipleCandidates} resumable tasks exist; resumed most recent (${result.taskId})`);
      }
      console.log(`task: ${result.taskId}`);
      console.log(`stage: ${result.stage}`);
      console.log(`status: ${result.status}`);
      console.log(`summary: ${result.summaryPath}`);
      process.exit(result.status === "completed" ? 0 : 2);
    } catch (err) {
      console.error(`agent-teams resume failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("design-resume")
  .description("Approve or send feedback for a task awaiting a Hana design checkpoint")
  .argument("<task_id>", "Task id to resume")
  .option("--approve", "Approve the current design and continue the task")
  .option("--feedback <text>", "Re-run Hana with the given feedback")
  .action(async (
    taskId: string,
    options: { approve?: boolean; feedback?: string },
  ) => {
    if (!options.approve && !options.feedback) {
      console.error("error: design-resume requires either --approve or --feedback");
      process.exit(1);
    }
    if (options.approve && options.feedback) {
      console.error("error: --approve and --feedback are mutually exclusive");
      process.exit(1);
    }
    try {
      const result = await resumeDesignTask({
        taskId,
        ...(options.approve ? { approve: true } : {}),
        ...(options.feedback ? { feedback: options.feedback } : {}),
      });
      console.log(`task: ${result.taskId}`);
      console.log(`status: ${result.status}`);
      console.log(`iteration: ${result.iteration}`);
      if (result.summaryPath) console.log(`summary: ${result.summaryPath}`);
      if (result.status === "awaiting_user_input") {
        // Same convention as `run`: pause is success exit, not failure.
        process.exit(0);
      }
      process.exit(result.status === "failed" ? 2 : 0);
    } catch (err) {
      console.error(`agent-teams design-resume failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

const workspaceCmd = program
  .command("workspace")
  .description("Manage multi-repo workspace configs");

workspaceCmd
  .command("list")
  .description("List workspace names in ~/.agent-teams/workspaces/")
  .action(() => {
    const names = listWorkspaces();
    if (names.length === 0) {
      console.log("(no workspaces configured)");
      return;
    }
    for (const n of names) console.log(n);
  });

workspaceCmd
  .command("show <name>")
  .description("Print the resolved workspace (name, repos with absolute paths)")
  .action((name: string) => {
    try {
      const ws = loadWorkspace(name);
      console.log(JSON.stringify(ws, null, 2));
    } catch (err) {
      console.error(`agent-teams workspace show failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
