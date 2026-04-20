# agent-teams

Orchestrate multiple Claude Code instances as a coding team.

You hit `/team "<task>"` inside a Claude Code session; a **planner** sub-agent triages and decomposes the task into a DAG of sub-tasks; the orchestrator runs each worker as an in-process `claude -p` child process (capped by `maxParallel`), respecting `dependsOn` ordering (e.g. reviewers run only after their implementers finish); a **summarizer** produces a combined report when everything lands.

An optional Tauri desktop GUI ships a live workflow graph (Planning → workers → Summary, with DAG layers) and a per-agent report viewer.

## Status

MVP. Expect rough edges. Designed for personal use on macOS; Linux should work but is unverified.

## Prerequisites

- macOS (tested) or Linux
- Node.js 20 or later
- [pnpm](https://pnpm.io) 10+
- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) CLI (`claude`) with agents registered (`claude agents list`)
- `better-sqlite3` builds a native module, so you need a C++ toolchain (Xcode command-line tools on macOS)
- Optional: [cmux](https://cmux.sh) — if present, the orchestrator emits status and log events into the containing cmux workspace. Workers run in-process regardless, so agent-teams works fine without cmux.
- Optional: Rust toolchain (`rustup`) — required only when building the Tauri desktop GUI.

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

Builds the Tauri report viewer in `packages/gui/` and drops the `.app` / `.dmg` bundle under `dist-gui/`.

The GUI has two view modes:

- **List** — three-column layout (calendar + task list / agent sidebar / report markdown). The report pane renders `summary.md` or any agent's `report.md`.
- **Graph** — live workflow visualization. `Planning (Sage)` → DAG-layered workers → `Summary (Sage)` as a pinch-zoomable SVG pipeline. Nodes pulse while running, and clicking a node opens a side drawer with that node's report (or planner events / sub-task list for the Planning node).

Live updates come from a filesystem watcher on `~/.agent-teams/tasks/`, so both views refresh while a run is in flight.

## Usage

1. Drop an `agent-team.yaml` in the repo you want to drive (copy from the root of this repo).
2. Start a Claude Code session in that repo (inside cmux for status/log observability, or anywhere — it's optional).
3. In the Claude Code prompt, run:

   ```
   /team "add a hello-world section to the README"
   ```

4. The orchestrator triages + plans, then runs each sub-task as an in-process `claude -p` child (capped by `maxParallel`, respecting the plan's `dependsOn` DAG). Per-agent reports land at `~/.agent-teams/tasks/<task-id>/agents/<sub-id>/report.md` and the team summary at `~/.agent-teams/tasks/<task-id>/summary.md`.

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
| `AGENT_TEAMS_WORKSPACES_DIR` | `$AGENT_TEAMS_HOME/workspaces` | multi-repo workspace YAML location |
| `AGENT_TEAMS_AGENTS_DIR` | `<repo>/agents` | bundled agent markdown directory (override to swap the roster per environment) |
| `AGENT_TEAMS_BIN_DIR` | `~/.local/bin` | where `setup.sh` drops `agent-teams` symlinks |
| `CLAUDE_COMMANDS_DIR` | `~/.claude/commands` | where `setup.sh` symlinks the slash commands |

## Data layout

```
~/.agent-teams/
├── db.sqlite                        # tasks / sub_tasks / agent_runs (WAL mode)
├── workspaces/                      # optional multi-repo workspace configs
│   └── <name>.yaml
└── tasks/
    └── <task-ulid>/
        ├── task.json                # immutable snapshot of inputs + plan
        ├── triage-events.jsonl      # Sage's triage stream-json
        ├── planner-events.jsonl     # Sage's planning stream-json
        ├── summarizer-events.jsonl  # Sage's summarizer stream-json
        ├── summary.md               # team-wide summary (Japanese markdown)
        └── agents/
            └── <sub-task-ulid>/
                ├── events.jsonl     # worker stream-json events
                └── report.md        # per-agent final report
```

`sub_tasks.depends_on` is a JSON array of sibling sub-task ids (`NULL` = no prerequisites). The orchestrator schedules via topological order; the GUI's `layoutWorkflow` renders those edges as worker layers.

## Architecture

```
Claude Code session
  └─ /team <task>
      └─ agent-teams run "<task>"
          ├─ triage    (Sage)  -> { difficulty, selectedAgents[] }
          ├─ plan      (Sage)  -> SubTask[] with id + dependsOn (DAG)
          ├─ runDag(subTasks, maxParallel):
          │     each ready sub-task -> child claude -p (stream-json)
          │     writes events.jsonl + report.md on completion
          ├─ wait for all sub-tasks to terminate (success or failure)
          └─ summarize (Sage)  -> summary.md
```

Workers are spawned as in-process `claude -p` child processes directly by the orchestrator — no cmux panes are created. The `runDag` scheduler keeps `maxParallel` workers inflight and releases dependents once every prerequisite finishes. A dependency's failure does not block its dependents (the worker itself decides how to react to missing upstream output).

### Difficulty-driven scaling

Before planning, a **triage** step classifies the task as `trivial`, `small`, `medium`, `large`, or `xlarge` and picks the minimal sufficient subset of agents from the full roster. The planner then works **only with that subset**, and the number of sub-tasks is bounded by the difficulty:

| difficulty | sub-task count | typical agents selected |
| --- | --- | --- |
| `trivial` | 1 | 1 (e.g. just Lin for a README typo) |
| `small` | 1–2 | 1–2 |
| `medium` | 2–3 | 2–4 |
| `large` | 3–5 | 3–6 |
| `xlarge` | 5–7 | up to 8 |

This keeps trivial tasks from running 8 workers in parallel and expensive tasks from being squeezed into 2. Triage events are logged to `~/.agent-teams/tasks/<id>/triage-events.jsonl`.

### DAG dependencies

Sage emits `id` and optional `dependsOn: string[]` for each sub-task in the plan. The orchestrator schedules workers topologically — e.g. `Iris` (code-reviewer) waits for `Kai` (implementer) to finish, but two reviewers with the same `dependsOn` run in parallel after the implementer. Cycles and unresolved references are rejected by `validatePlanDag` before any worker starts.

## Non-goals (MVP)

- DAG sub-task dependencies with conditional branching (the current DAG is unconditional — every ready sub-task runs regardless of upstream outcome)
- CI / remote execution
- A2A / MCP protocol between agents (today each worker only sees its own prompt + any peer-repo read-only context)

## License

MIT. See [`LICENSE`](LICENSE).
