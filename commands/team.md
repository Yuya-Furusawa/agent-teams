---
description: Dispatch a coding task to the agent-teams orchestrator (spawns planner + workers in cmux panes)
argument-hint: <natural-language task description>
allowed-tools: Bash(agent-teams:*), Read
---

Run the agent-teams orchestrator for this task. It will spawn a planner and worker Claude Code agents across new cmux panes, then produce a summary report.

引数として PBI 番号（例: `42` や `PBI-42`）を渡すと、設定済み Obsidian Vault から該当 PBI を読み込んで実装フェーズに乗せます。

Execute:

```bash
agent-teams run "$ARGUMENTS"
```

After the command finishes, read the printed summary file path and display its contents to the user. Do not perform any coding work yourself beyond invoking this command — the agent team handles the actual implementation.
