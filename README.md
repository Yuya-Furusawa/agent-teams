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
2. symlink `agent-teams` into `~/.local/bin/` (override with `AGENT_TEAMS_BIN_DIR`)
3. symlink `commands/team.md` and `commands/team-ws.md` to `~/.claude/commands/`
4. create `~/.agent-teams/` (tasks + workspaces subdirs) for task history and workspace configs

Make sure `~/.local/bin` is on your `PATH` — if it isn't, `setup.sh` prints the line to add to your shell rc at the end.

Pass `--yes` to skip overwrite prompts and `--dry-run` to preview actions.

### Optional: build the desktop GUI

```bash
./setup.sh --with-gui
```

Builds the Tauri report viewer in `packages/gui/` and drops the `.app` / `.dmg` bundle under `dist-gui/`. See [`docs/superpowers/specs/2026-04-19-tauri-gui-report-viewer-design.md`](docs/superpowers/specs/2026-04-19-tauri-gui-report-viewer-design.md) for scope.

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

### Multi-repo workspaces

For tasks that span multiple repos (e.g., adding a feature that touches both a frontend and backend repo), define a **workspace** in `~/.agent-teams/workspaces/<name>.yaml`:

```yaml
name: my-app
repos:
  - name: frontend
    path: /Users/me/Works/my-app-frontend
    role: "React SPA. API client は src/api/"
  - name: backend
    path: /Users/me/Works/my-app-backend
    role: "Rails API. controllers は app/controllers/api/"
```

No team definition is required — the orchestrator automatically uses `Sage` as planner and all other bundled agents as workers. Triage will pick the smallest sufficient subset based on the task.

Then run from any Claude Code session:

```
/team-ws my-app "ユーザープロフィール編集機能を追加。backend は PATCH /users/:id、frontend は編集フォーム"
```

or directly:

```bash
agent-teams run --workspace my-app "..."
```

Each sub-task is executed with its assigned repo as the working directory, and the worker's system prompt includes the list of peer repos as read-only reference (for looking up API contracts, shared types, etc.).

Helpers: `agent-teams workspace list` prints configured workspace names; `agent-teams workspace show <name>` prints the resolved config with absolute paths.

Override workspace storage with `AGENT_TEAMS_WORKSPACES_DIR=/custom/path`.

## Configuration

### Team roster — `agent-team.yaml`

```yaml
name: default-dev-team
planner: Sage
workers:
  # Each entry is an agent by name. The file agents/<Name>.md must exist.
  - Kai      # pragmatic implementer
  - Aki      # architecture-minded implementer
  - Mika     # test-first implementer
  - Iris     # code reviewer
  - Quinn    # QA engineer
  - Ren      # researcher
  - Nova     # browser / E2E
  - Juno     # debugger
  - Atlas    # DevOps / infra
  - Lin      # documentation writer
defaults:
  maxParallel: 4
  # model: claude-opus-4-7
```

### Multiple agents sharing a role

Each agent is its own file under `agents/<Name>.md`. Frontmatter can carry a `role:` tag which is metadata only — several agents can share the same role. In the default team, `Kai`, `Aki`, and `Mika` are three independent agents that all declare `role: implementer` but have distinct personalities and body prompts.

- The **file name must match** the frontmatter `name`. `agents/Kai.md` has `name: Kai`.
- Duplicate `name`s across files are rejected at load time.
- The planner picks between agents by name — it sees the full list with each agent's description and personality, and outputs `assignedAgent: "Kai"` (or `"Aki"`, etc.).

### Where agent definitions come from

The repository ships a set of agents under [`agents/`](agents/). Each is a markdown file with YAML frontmatter (`name`, `description`) plus a system-prompt body.

At every invocation the orchestrator reads this directory and passes the agents to `claude -p` via `--agents <json>`. **You do not need to install the agents into the workspace's `.claude/agents/` directory** — they are auto-injected per-run.

Agent names in `agent-team.yaml` resolve in this order:
1. definitions in `<agent-teams-repo>/agents/` (auto-injected)
2. Claude Code built-ins (`general-purpose`, `Explore`, `Plan`, `statusline-setup`)
3. user-scope `~/.claude/agents/*.md`

Override the lookup path with `AGENT_TEAMS_AGENTS_DIR=/custom/path` if you want to swap the roster per environment.

### Agents, roles, and personalities

Every bundled agent file has:
- **`name`** (e.g. `Kai`) — the agent's identifier. Must match the filename (`agents/Kai.md`). Used as the routing key in `agent-team.yaml` and in planner output.
- **`role`** (e.g. `implementer`) — optional metadata grouping agents with similar charters. Multiple agents can share a role (three implementers share `role: implementer`).
- **`personality`** — optional short paragraph describing temperament and working style. Injected into the system prompt as a `# Personality` section.
- **`description`** — one-paragraph "when to use / when not to use" that the planner reads to decide who gets which sub-task.

The current roster:

| name | role | one-line personality |
| --- | --- | --- |
| Kai | implementer | pragmatic, ships fast, smallest change |
| Aki | implementer | architecture-minded, reads first, small incremental |
| Mika | implementer | test-first / TDD |
| Iris | code-reviewer | sharp-eyed but fair; must-fix vs nice-to-fix |
| Quinn | qa-engineer | methodical, paranoid about edge cases |
| Ren | researcher | curious but disciplined, cites evidence |
| Nova | browser-operator | user-empathetic, hates flaky tests |
| Juno | debugger | patient and skeptical, roots-not-symptoms |
| Atlas | devops-engineer | calm, blast-radius-aware |
| Lin | docs-writer | clear and reader-first |
| Sage | team-planner | decisive and concise |

### Customizing or adding agents

Edit the existing files under `agents/` or drop a new `<name>.md` there. Frontmatter shape:

```markdown
---
name: Rio
role: implementer
personality: >
  Decisive and allergic to abstractions. Prefers two concrete implementations
  over one speculative interface.
description: One-paragraph "when to use / when not to use" aimed at the planner.
---

System-prompt body goes here…
```

Save as `agents/Rio.md` and add `- Rio` to `agent-team.yaml`'s `workers:` list. `role` and `personality` are optional but strongly recommended — the role helps the planner understand what kind of work the agent does, and the personality steers behavior.

Save the file and you're done — the agents directory is re-read on every `/team` invocation, so no rebuild is needed for markdown edits.

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
          ├─ triage    (Sage)  -> { difficulty, selectedAgents[] }
          ├─ plan      (Sage)  -> SubTask[] (sub-task count fits difficulty)
          ├─ for each sub-task:
          │   cmux new-pane --type terminal -> pane
          │   cmux send "agent-teams-internal worker <task-id> <sub-id>"
          │     └─ child claude -p (stream-json) writes report.md
          ├─ wait for all sub-tasks (SQLite poll)
          └─ summarize (Sage)  -> summary.md
```

### Difficulty-driven scaling

Before planning, a **triage** step classifies the task as `trivial`, `small`, `medium`, `large`, or `xlarge` and picks the minimal sufficient subset of agents from the full roster. The planner then works **only with that subset**, and the number of sub-tasks is bounded by the difficulty:

| difficulty | sub-task count | typical agents selected |
| --- | --- | --- |
| `trivial` | 1 | 1 (e.g. just Lin for a README typo) |
| `small` | 1–2 | 1–2 |
| `medium` | 2–3 | 2–4 |
| `large` | 3–5 | 3–6 |
| `xlarge` | 5–7 | up to 8 |

This keeps trivial tasks from spinning up 8 panes and expensive tasks from being squeezed into 2. Triage events are logged to `~/.agent-teams/tasks/<id>/triage-events.jsonl`.

See [`/Users/yuyafurusawa/.claude/plans/coding-agent-recursive-graham.md`](docs/plan.md) if you're the author; external users can read [docs/architecture.md](docs/architecture.md) (TODO).

## Non-goals (MVP)

- GUI (planned: Tauri desktop app for reports)
- Multi-repo workspace management (planned)
- DAG-based sub-task dependencies (planned)
- CI / remote execution

## License

MIT. See [`LICENSE`](LICENSE).
