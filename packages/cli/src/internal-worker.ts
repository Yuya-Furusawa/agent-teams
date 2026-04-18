#!/usr/bin/env node
import {
  buildInstanceInlineAgents,
  loadAgentRegistry,
  loadTeam,
  resolvePlannerInstance,
  resolveTeam,
  runWorker,
} from "@agent-teams/orchestrator";
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

      const team = loadTeam(`${task.cwd}/agent-team.yaml`);
      const registry = loadAgentRegistry();
      const workerInstances = resolveTeam(team, registry);
      const plannerInstance = resolvePlannerInstance(team, registry);
      const inlineAgents = buildInstanceInlineAgents([
        ...workerInstances,
        plannerInstance,
      ]);

      const instance = workerInstances.find((i) => i.name === subTask.assigned_agent);
      if (!instance) {
        console.error(
          `no worker "${subTask.assigned_agent}" in team ${team.name}`,
        );
        process.exit(1);
      }

      const roleLabel = instance.role ? ` (role ${instance.role})` : "";
      console.log(
        `[agent-teams] starting ${instance.name}${roleLabel} for sub-task: ${subTask.title}`,
      );

      const { exitCode, reportPath } = await runWorker({
        taskId,
        subTaskId,
        agent: instance.name,
        originalTask: task.description,
        subTaskTitle: subTask.title,
        subTaskPrompt: subTask.prompt,
        cwd: task.cwd,
        model: team.defaults?.model,
        inlineAgents,
      });

      console.log(
        `[agent-teams] ${instance.name} exited with code ${exitCode}. report: ${reportPath}`,
      );
      process.exit(exitCode === 0 ? 0 : 2);
    } finally {
      storage.close();
    }
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
