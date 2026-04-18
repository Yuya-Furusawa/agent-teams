#!/usr/bin/env node
import { runTask } from "@agent-teams/orchestrator";
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
  .action(async (taskWords: string[], options: { team?: string; cwd?: string }) => {
    const description = taskWords.join(" ").trim();
    if (!description) {
      console.error("error: task description is required");
      process.exit(1);
    }
    try {
      const result = await runTask({
        description,
        cwd: options.cwd,
        teamPath: options.team,
      });
      console.log(`task: ${result.taskId}`);
      console.log(`status: ${result.status}`);
      console.log(`summary: ${result.summaryPath}`);
      process.exit(result.status === "completed" ? 0 : 2);
    } catch (err) {
      console.error(`agent-teams run failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
