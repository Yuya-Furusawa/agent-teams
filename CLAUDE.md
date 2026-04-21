# agent-teams

Local orchestrator that runs a team of Claude Code sub-agents for one user task: a **planner** sub-agent decomposes the task into sub-tasks, **worker** sub-agents execute each concurrently in-process (capped by `defaults.maxParallel`), and the planner is re-invoked as the **summarizer** to produce a final report.

Invoked from a Claude Code session via slash command `/team "<task>"` → `agent-teams run "..."` CLI.

## Prereqs

- Node 20+, pnpm 10+
- `claude` CLI on PATH with agents registered (`claude agents list`)
- `cmux` CLI is **optional** — if present, the orchestrator emits status / log events into the active cmux workspace. If absent, those calls are skipped silently. Workers no longer run inside cmux terminal panes; they run as in-process `claude -p` child processes spawned by the orchestrator.

## Layout (pnpm monorepo)

```
agents/           # bundled sub-agent definitions (.md, YAML frontmatter + system prompt body)
                  #   auto-injected into every `claude -p` run via --agents <json>
                  #   override location with $AGENT_TEAMS_AGENTS_DIR
packages/
  cmux-adapter/   # cmux CLI wrapper (currentWorkspace, setStatus, log, …) — status/log only
  storage/        # SQLite (tasks/sub_tasks/agent_runs) + files (events.jsonl, report.md)
  agent-runner/   # spawns `claude -p --output-format stream-json`, parses events
  orchestrator/   # team loader, agent-registry loader, planner runner, worker dispatch, summarizer
  cli/            # `agent-teams` bin
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
3. **Triage**: `Sage` runs with the full roster; classifies difficulty (trivial / small / medium / large / xlarge) and selects the smallest sufficient subset of agents. Events → `triage-events.jsonl`
4. **Plan**: `Sage` runs again with the restricted roster + difficulty hint; outputs sub-tasks whose count matches the difficulty (trivial=1, small=1–2, medium=2–3, large=3–5, xlarge=5–7). Events → `planner-events.jsonl`
5. `agent-runner` parses the closing JSON for each of (3) and (4) — either from a `result` event or a fenced-block fallback on `lastText`
6. For each sub-task, orchestrator invokes `runWorker` directly in-process (parallelism capped by `team.defaults.maxParallel`, default 3). Each worker is a `claude -p` child process spawned by `agent-runner`. No cmux panes are created.
7. Each worker writes raw stream-json events to `agents/<id>/events.jsonl` and writes `report.md` as its final step (appended-system-prompt contract). Fallback: if no file is written, the worker's last assistant text is saved as the report
8. Once all in-process worker promises resolve, the orchestrator re-runs Sage in **summarizer mode** → `summary.md`

## cmux model (status/log only)

The orchestrator uses cmux only for observability of the containing workspace: `setStatus`, `clearStatus`, and `log`. All calls are guarded by a nullable `workspace` handle (`currentWorkspace().catch(() => null)`), so running without cmux just silently skips these calls.

## Planner/summarizer JSON contract

The planner is instructed (via the user-prompt wording and the `team-planner` agent's system prompt) to close its response with a single fenced ```json``` code block. The parser in `agent-runner` tries, in order:

1. `result` event payload (when `claude -p` emits structured output)
2. Last fenced ```json block in the final assistant text
3. First `{ ... }` substring in the final text

The sample `agent-team.yaml` defaults to `planner: team-planner` — a dedicated bundled agent whose system prompt reinforces the JSON contract. Built-in narrative agents (e.g. `Plan`) tend to ignore the contract; avoid them in the `planner` slot.

## Bundled agents (auto-injected)

`agents/<name>.md` files are loaded at runtime by `packages/orchestrator/src/agent-registry.ts` and passed to every `claude -p` invocation via `--agents <json>`. Result: workspaces that use `agent-teams` never need to copy agent definitions into `.claude/agents/`.

To add or edit an agent, just touch the markdown under `agents/` — **no rebuild needed** for content changes (TS code doesn't import from those files). `loadAgentRegistry()` reads them fresh on every run.

Built-in Claude agents (`general-purpose`, `Explore`, `Plan`, `statusline-setup`) are also accepted as team members — `validateTeamAgainstRegistry` allow-lists them.

## Agent model

Each agent is an **independent** markdown file at `agents/<Name>.md`. The filename must match the frontmatter `name`. The `name` is the routing key used everywhere (team.yaml, planner output, `--agents` JSON key, report signature).

Frontmatter fields (all optional except `name` and the body):
- `name` — identifier (= filename, = display, = routing key). Unique across all files.
- `role` — metadata string. Multiple agents may share a role (e.g. three implementers share `role: implementer`).
- `personality` — short trait paragraph injected as a `# Personality` section into the system prompt.
- `description` — "when to use / when not to use" paragraph read by the planner.
- `model` / `tools` — optional, pass-through to the inline agent definition.

### Injection pipeline

`buildInstanceInlineAgents()` in `instance.ts` wraps each agent's body with:

```
You are <name>, a member of a coordinated coding-agent team. Your role on the team is "<role>". Sign any report…

# Personality
<personality>

<body from agents/<name>.md>
```

The planner, summarizer, and every worker receive the **same** inline agents map (keyed by `name`), so cross-agent references resolve uniformly.

### Where each field surfaces

- `name` → planner roster entries, `sub_tasks.assigned_agent` column, report signature
- `role` → planner roster text ("`Kai (role: implementer)`"), summarizer report sections, orchestrator's `roleOf()` lookup
- `personality` → only inside the injected system prompt (not user-visible metadata)

### Why independent files per agent

Earlier designs shared a role body across personas and overrode just persona + personality via `team.yaml` object form. We moved to one-file-per-agent because each persona needs its own body to encode distinct working style — Aki's body should emphasize reading before writing, Mika's body should enforce test-first discipline, etc. Personality alone can't carry that without the body backing it up.

### Default roster

15 agents: 1 planner (Sage) + 14 workers. Kai/Aki/Mika (role: implementer), Iris (code-reviewer), Haru (maintainability-reviewer), Vale (security-reviewer), Kiri (simplicity-reviewer), Tess (test-reviewer), Quinn (qa-engineer), Ren (researcher), Nova (browser-operator), Juno (debugger), Atlas (devops-engineer), Lin (docs-writer).

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

All workers run in-process (same Node process as the orchestrator), each spawning its own `claude -p` child. WAL mode on SQLite is still enabled so GUI readers and any external tools can safely observe the DB while a run is active. Per-task filesystem paths are namespaced by ULID so workers never collide.

## Multi-repo workspaces

For tasks spanning multiple repos, define `~/.agent-teams/workspaces/<name>.yaml`:

```yaml
name: my-app
repos:
  - { name: frontend, path: /abs/path/fe, role: "React SPA" }
  - { name: backend,  path: /abs/path/be, role: "Rails API" }
```

**No team config in the workspace file.** `resolveWorkspaceTeam` in `instance.ts` auto-constructs the team: planner = `Sage`, workers = every registered agent except the planner, defaults = `{ model: claude-opus-4-7, maxParallel: 3 }`.

Invoked via `agent-teams run --workspace <name>` or `/team-ws <name> <task>`. Flow differs from single-repo only in:

1. `runTask` loads the workspace, auto-resolves the team, and passes `repos` to triage/planner/summarizer prompts
2. Planner schema requires `targetRepo` per sub-task (validated against the workspace repo list)
3. `resolveWorkerScope` computes each worker's `cwd = repo.path` and injects `peerRepos` (read-only reference) into the worker's appended system prompt
4. `tasks.workspace_name`, `tasks.repos`, `sub_tasks.target_repo` columns (nullable, auto-migrated) record workspace state for the GUI

GUI: `Task.workspace` renders a badge on the task row; `SubTask.targetRepo` renders a badge in the agent sidebar. Added via `list_workspaces` Tauri command + additional SELECT projections — see `packages/gui/src-tauri/src/db.rs` and `packages/gui/src-tauri/src/lib.rs`.

Single-repo mode (`/team` + `agent-team.yaml`) is unchanged and fully supported.

## Environment variables

- `AGENT_TEAMS_HOME` (default `~/.agent-teams`) — data root
- `AGENT_TEAMS_DB` — SQLite path override
- `AGENT_TEAMS_WORKSPACES_DIR` (default `$AGENT_TEAMS_HOME/workspaces`) — workspace YAML location
- `AGENT_TEAMS_BIN_DIR` (default `~/.local/bin`) — where `setup.sh` drops bin symlinks
- `CLAUDE_COMMANDS_DIR` (default `~/.claude/commands`) — where `setup.sh` puts the slash commands

## Out of scope (MVP)

GUI (planned: Tauri), multi-repo workspace abstraction, DAG sub-task dependencies, CI/remote execution, A2A/MCP between agents. The design doc lives at `/Users/yuyafurusawa/.claude/plans/coding-agent-recursive-graham.md`.

## Conventions

- ES modules, `"type": "module"`. Imports use `.js` extensions pointing at compiled output (TS rewrites at build).
- Every package ships its own `dist/` via `tsc --build`. Project references keep incremental builds working.
- `verbatimModuleSyntax: true` is on — use `import type` for types.
- No hard-coded user paths in source. Read from env vars (`AGENT_TEAMS_HOME` etc.).
- Don't re-introduce Unix-socket / hook-bridge IPC: the Stop hook path was intentionally dropped in favor of `--include-hook-events` and an in-prompt "write report.md" contract.
