# agent-teams

Local orchestrator that runs a team of Claude Code sub-agents for one user task: a **planner** sub-agent decomposes the task into sub-tasks, **worker** sub-agents execute each in its own cmux terminal pane, and the planner is re-invoked as the **summarizer** to produce a final report.

Invoked from a Claude Code session via slash command `/team "<task>"` → `agent-teams run "..."` CLI.

## Prereqs

- Node 20+, pnpm 10+
- `claude` CLI on PATH with agents registered (`claude agents list`)
- `cmux` CLI on PATH; the orchestrator drives the currently-running cmux workspace

## Layout (pnpm monorepo)

```
packages/
  cmux-adapter/   # cmux CLI wrapper (currentWorkspace, newTerminalPane, send, …)
  storage/        # SQLite (tasks/sub_tasks/agent_runs) + files (events.jsonl, report.md)
  agent-runner/   # spawns `claude -p --output-format stream-json`, parses events
  orchestrator/   # team loader, planner runner, worker dispatch, summarizer
  cli/            # `agent-teams` + `agent-teams-internal worker` bins
commands/team.md  # slash command template (symlinked to ~/.claude/commands/ by setup.sh)
setup.sh          # scaffold + symlink installer; supports --dry-run / --yes
agent-team.yaml   # sample team config (planner + worker roster)
```

Dependency direction (left depends on right):
`cli → orchestrator → {cmux-adapter, storage, agent-runner}`. No cross-deps between leaf packages.

## Common commands

```bash
pnpm -r build          # compile all packages
pnpm --filter @agent-teams/<pkg> build
./setup.sh --dry-run   # preview installer actions
./setup.sh --yes       # non-interactive install (overwrites existing symlinks)
```

After editing source: `pnpm -r build` is enough. The `~/.local/bin/agent-teams*` and `~/.claude/commands/team.md` symlinks point at files that the build overwrites in place — no re-setup needed.

## Runtime flow

1. `/team "<task>"` → slash command runs `agent-teams run`
2. CLI loads `./agent-team.yaml`, creates task ULID, inserts a `tasks` row
3. Planner: `claude -p --agent <planner> ...` with an appended system prompt demanding a closing fenced JSON block. Events are tee'd to `~/.agent-teams/tasks/<id>/planner-events.jsonl`
4. agent-runner parses the closing JSON (either from a `result` event or via a fenced-block fallback on `lastText`)
5. For each sub-task, orchestrator creates a fresh terminal pane with `cmux new-pane --type terminal` and sends `agent-teams-internal worker <task> <sub>` to its selected surface
6. Each worker writes raw stream-json events to `agents/<id>/events.jsonl` and writes `report.md` as its final step (appended-system-prompt contract). Fallback: if no file is written, the worker's last assistant text is saved as the report
7. Orchestrator polls SQLite (`sub_tasks.status`) until all workers finish, then re-runs the planner in summarizer mode → `summary.md`

## cmux model (important!)

cmux distinguishes **panes** (visual rectangles) from **surfaces** (the actual terminal/browser inside a pane). Each pane can host multiple surfaces.

- `send`, `send-key`, `rename-tab` take `--surface <surface-ref>` — **not** pane refs
- Use `new-pane --type terminal --direction <dir>` (**not** `new-split`) to guarantee a terminal surface
- After `new-pane`, resolve the selected surface via `list-pane-surfaces --pane <ref>`

Passing a pane ref to `--surface` produces `invalid_params: Surface is not a terminal`. The adapter (`cmux-adapter`) encapsulates this — callers work with `SurfaceRef` only.

## Planner/summarizer JSON contract

The planner is instructed (via `--append-system-prompt`) to close its response with a single fenced ```json``` code block. The parser in `agent-runner` tries, in order:

1. `result` event payload (when `claude -p` emits structured output)
2. Last fenced ```json block in the final assistant text
3. First `{ ... }` substring in the final text

If the configured planner has a narrative-heavy preset (e.g. the built-in `Plan` architect), it may ignore the JSON instruction. The sample `agent-team.yaml` defaults to `general-purpose` for this reason.

## Data layout

```
~/.agent-teams/
├── db.sqlite                   # WAL mode; tasks/sub_tasks/agent_runs
└── tasks/<task-ulid>/
    ├── task.json               # immutable input + plan snapshot
    ├── summary.md              # team-wide summary
    ├── planner-events.jsonl    # planner stream-json
    ├── summarizer-events.jsonl # summarizer stream-json
    └── agents/<sub-ulid>/
        ├── events.jsonl        # worker stream-json
        └── report.md           # worker final report
```

Multiple processes (orchestrator + N workers) write to the same SQLite file; WAL mode handles concurrency. Per-task filesystem paths are namespaced by ULID so workers never collide.

## Environment variables

- `AGENT_TEAMS_HOME` (default `~/.agent-teams`) — data root
- `AGENT_TEAMS_DB` — SQLite path override
- `AGENT_TEAMS_BIN_DIR` (default `~/.local/bin`) — where `setup.sh` drops bin symlinks
- `CLAUDE_COMMANDS_DIR` (default `~/.claude/commands`) — where `setup.sh` puts the slash command

## Out of scope (MVP)

GUI (planned: Tauri), multi-repo workspace abstraction, DAG sub-task dependencies, CI/remote execution, A2A/MCP between agents. The design doc lives at `/Users/yuyafurusawa/.claude/plans/coding-agent-recursive-graham.md`.

## Conventions

- ES modules, `"type": "module"`. Imports use `.js` extensions pointing at compiled output (TS rewrites at build).
- Every package ships its own `dist/` via `tsc --build`. Project references keep incremental builds working.
- `verbatimModuleSyntax: true` is on — use `import type` for types.
- No hard-coded user paths in source. Read from env vars (`AGENT_TEAMS_HOME` etc.).
- Don't re-introduce Unix-socket / hook-bridge IPC: the Stop hook path was intentionally dropped in favor of `--include-hook-events` and an in-prompt "write report.md" contract.
