---
description: Dispatch a coding task to the agent-teams orchestrator (spawns planner + workers in cmux panes)
argument-hint: <natural-language task description>
allowed-tools: Bash(agent-teams:*), Read
---

Run the agent-teams orchestrator for this task. It will spawn a planner and worker Claude Code agents across new cmux panes, then produce a summary report.

Execute:

```bash
agent-teams run "$ARGUMENTS"
```

After the command finishes, read the printed summary file path and display its contents to the user. Do not perform any coding work yourself beyond invoking this command — the agent team handles the actual implementation.
