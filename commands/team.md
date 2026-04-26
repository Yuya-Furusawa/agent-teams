---
description: Dispatch a coding task to the agent-teams orchestrator (also resumes interrupted tasks when asked: "実装を再開して" / "続きをやって" / "resume")
argument-hint: <natural-language task description | PBI number | "resume">
allowed-tools: Bash(agent-teams:*), Read
---

Run the agent-teams orchestrator for this task. It will spawn a planner and worker Claude Code agents in-process, then produce a summary report.

引数として PBI 番号（例: `42` や `PBI-42`）を渡すと、設定済み Obsidian Vault から該当 PBI を読み込んで実装フェーズに乗せます。

If the user is asking to resume a previously-interrupted task (phrases like "実装を再開して", "続きをやって", "resume", "continue") AND the input does not contain "PBI", invoke `agent-teams resume` instead of `agent-teams run`. The resume command auto-selects the most recent failed/running task and re-runs only its incomplete sub-tasks. If the user explicitly references a task id (e.g. "01HXABC..."), prefer the dedicated `/team-resume <task_id>` slash command over `/team`.

Execute (for a normal new task or PBI):

```bash
agent-teams run "$ARGUMENTS"
```

Execute (for a resume request, no task id):

```bash
agent-teams resume
```

After the command finishes, read the printed `summary` path and display its contents to the user. Do not perform any coding work yourself beyond invoking the appropriate command.
