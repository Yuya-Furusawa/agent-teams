#!/usr/bin/env node
import { runWorker, loadTeam } from "@agent-teams/orchestrator";
import { Storage } from "@agent-teams/storage";
import { Command } from "commander";

const program = new Command();

program
  .name("agent-teams-internal")
  .description("Internal subcommands invoked by the orchestrator inside cmux panes")
  .version("0.1.0");

program
  .command("worker")
  .description("Run a worker agent for a specific sub-task")
  .argument("<taskId>", "Parent task ULID")
  .argument("<subTaskId>", "Sub-task ULID")
  .action(async (taskId: string, subTaskId: string) => {
    const storage = new Storage();
    try {
      const task = storage.getTask(taskId);
      if (!task) {
        console.error(`task ${taskId} not found`);
        process.exit(1);
      }
      const subTask = storage.db
        .prepare("SELECT * FROM sub_tasks WHERE id = ? AND task_id = ?")
        .get(subTaskId, taskId) as
        | {
            id: string;
            title: string;
            prompt: string;
            assigned_agent: string;
          }
        | undefined;
      if (!subTask) {
        console.error(`sub-task ${subTaskId} not found under task ${taskId}`);
        process.exit(1);
      }

      let teamModel: string | undefined;
      try {
        const team = loadTeam(`${task.cwd}/agent-team.yaml`);
        teamModel = team.defaults?.model;
      } catch {
        // team file might have moved; proceed without model override
      }

      console.log(`[agent-teams] starting worker ${subTask.assigned_agent} for sub-task: ${subTask.title}`);

      const { exitCode, reportPath } = await runWorker({
        taskId,
        subTaskId,
        agent: subTask.assigned_agent,
        originalTask: task.description,
        subTaskTitle: subTask.title,
        subTaskPrompt: subTask.prompt,
        cwd: task.cwd,
        model: teamModel,
      });

      console.log(`[agent-teams] worker exited with code ${exitCode}. report: ${reportPath}`);
      process.exit(exitCode === 0 ? 0 : 2);
    } finally {
      storage.close();
    }
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
