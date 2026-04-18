# agent-teams

Orchestrate multiple Claude Code instances as a coding team, observed live through cmux panes.

You hit `/team "<task>"` inside a Claude Code session; a **planner** sub-agent decomposes the task and chooses which **worker** sub-agents run each part; the orchestrator spawns each worker in its own cmux pane and produces a combined summary when they all finish.

## Status

MVP. Expect rough edges. Designed for personal use on macOS; Linux should work but is unverified.

## Prerequisites

- macOS (tested) or Linux
- Node.js 20 or later
- [pnpm](https://pnpm.io) 10+
- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) CLI (`claude`) with agents registered (`claude agents list`)
- [cmux](https://cmux.sh) running — the orchestrator drives it via its CLI to open panes
- `better-sqlite3` builds a native module, so you need a C++ toolchain (Xcode command-line tools on macOS)

## Install

```bash
git clone https://github.com/<your-fork>/agent-teams.git
cd agent-teams
./setup.sh
```

`setup.sh` will:

1. `pnpm install` and `pnpm -r build`
2. symlink `agent-teams` / `agent-teams-internal` into `~/.local/bin/` (override with `AGENT_TEAMS_BIN_DIR`)
3. symlink `commands/team.md` to `~/.claude/commands/team.md`
4. create `~/.agent-teams/` for task history

Make sure `~/.local/bin` is on your `PATH` — if it isn't, `setup.sh` prints the line to add to your shell rc at the end.

Pass `--yes` to skip overwrite prompts and `--dry-run` to preview actions.

## Usage

1. Drop an `agent-team.yaml` in the repo you want to drive (copy from the root of this repo).
2. Open that repo inside a cmux workspace and start a Claude Code session in one of its panes.
3. In the Claude Code prompt, run:

   ```
   /team "add a hello-world section to the README"
   ```

4. The orchestrator opens one cmux pane per sub-task, each runs the assigned worker agent, and the final summary markdown is written to `~/.agent-teams/tasks/<task-id>/summary.md`.

You can also invoke the CLI directly from a terminal:

```bash
agent-teams run "add a hello-world section to the README"
```

## Configuration

### Team roster — `agent-team.yaml`

```yaml
name: default-dev-team
planner: general-purpose
workers:
  - Explore
  - general-purpose
  - superpowers:code-reviewer
defaults:
  maxParallel: 3
  # model: claude-opus-4-7
```

`planner` and each `workers[]` name must match something in `claude agents list`.

**Planner choice matters**: the orchestrator asks the planner to emit a fenced JSON code block as the last message, and parses it. Agents with narrative-heavy system prompts (e.g. the built-in `Plan` architect) may ignore this contract. `general-purpose` follows it reliably.

### Environment variables

| variable | default | purpose |
| --- | --- | --- |
| `AGENT_TEAMS_HOME` | `~/.agent-teams` | data directory (SQLite db + per-task files) |
| `AGENT_TEAMS_DB` | `$AGENT_TEAMS_HOME/db.sqlite` | SQLite path override |
| `AGENT_TEAMS_BIN_DIR` | `~/.local/bin` | where `setup.sh` drops `agent-teams` symlinks |
| `CLAUDE_COMMANDS_DIR` | `~/.claude/commands` | where `setup.sh` symlinks the slash command |

## Data layout

```
~/.agent-teams/
├── db.sqlite                    # tasks / sub_tasks / agent_runs
└── tasks/
    └── <task-ulid>/
        ├── task.json            # immutable snapshot of inputs + plan
        ├── summary.md           # team-wide summary
        └── agents/
            └── <sub-task-ulid>/
                ├── events.jsonl # raw claude stream-json events
                └── report.md    # per-agent final report
```

## Architecture

```
Claude Code session
  └─ /team <task>
      └─ agent-teams run "<task>"
          ├─ planner (claude -p --json-schema ...)  -> SubTask[]
          ├─ for each sub-task:
          │   cmux new-split -> pane
          │   cmux send "agent-teams-internal worker <task-id> <sub-id>"
          │     └─ child claude -p (stream-json) writes report.md
          ├─ wait for all sub-tasks (SQLite poll)
          └─ summarizer (planner re-run) -> summary.md
```

See [`/Users/yuyafurusawa/.claude/plans/coding-agent-recursive-graham.md`](docs/plan.md) if you're the author; external users can read [docs/architecture.md](docs/architecture.md) (TODO).

## Non-goals (MVP)

- GUI (planned: Tauri desktop app for reports)
- Multi-repo workspace management (planned)
- DAG-based sub-task dependencies (planned)
- CI / remote execution

## License

MIT. See [`LICENSE`](LICENSE).
