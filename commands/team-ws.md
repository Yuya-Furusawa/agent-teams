---
description: Dispatch a multi-repo workspace task to the agent-teams orchestrator
argument-hint: <workspace-name> <natural-language task description>
allowed-tools: Bash(agent-teams:*), Read
---

Run the agent-teams orchestrator against a multi-repo workspace. The first argument is the workspace name (see `~/.agent-teams/workspaces/<name>.yaml`); the rest is the task description. Each sub-task runs in its target repo's directory, and the summarizer writes one unified report.

Parse `$ARGUMENTS`: the first whitespace-delimited token is the workspace name, the remainder (joined with spaces) is the task description. Then execute:

```bash
agent-teams run --workspace "<workspace>" "<task>"
```

After the command finishes, read the printed summary file path and display its contents to the user. Do not perform any coding work yourself beyond invoking this command — the agent team handles the actual implementation.
