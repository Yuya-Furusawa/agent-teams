---
description: Resume the most recent stuck/failed agent-teams task (or a specific task id)
argument-hint: [task_id]
allowed-tools: Bash(agent-teams:*), Read
---

Resume an agent-teams task that was interrupted (e.g. by a Claude Code rate limit, or an orchestrator crash). Failed and stuck-running sub-tasks are re-executed; completed ones are preserved. After all sub-tasks finish, the summarizer regenerates `summary.md`.

Execute:

```bash
agent-teams resume "$ARGUMENTS"
```

After the command finishes, read the printed `summary` path and display its contents. If the command exits with "no resumable task found", report that to the user and stop.
