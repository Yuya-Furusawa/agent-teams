# Tauri GUI: Agent-Teams Report Viewer — Design

**Date:** 2026-04-19
**Status:** Design approved, ready for implementation plan
**Scope:** Phase 1 (MVP) desktop app for reading agent-teams task results

## Context

`agent-teams` persists each run under `~/.agent-teams/`:

- `db.sqlite` (WAL) — `tasks`, `sub_tasks`, `agent_runs` tables
- `tasks/<task-ulid>/summary.md` — team-wide summary (written by Sage summarizer)
- `tasks/<task-ulid>/agents/<sub-ulid>/report.md` — per-worker final report
- plus supporting JSONL event streams (`planner-events.jsonl`, worker `events.jsonl`, etc.)

Today these are read by opening files in a terminal or editor. Live observation happens in cmux panes during the run itself. The goal of this GUI is to give the user a calmer, structured way to browse completed runs and monitor the progress of running ones — **not** to replace cmux live observation or to control the orchestrator.

## Goals

1. Browse the history of tasks in a task list (latest 100, chronological).
2. For a selected task, show its `summary.md` plus each worker agent's `report.md`.
3. Reflect in-progress tasks with status (`planning` / `running` / `completed` / `failed` / `partial`) and update the list + detail when sub-tasks complete.
4. Zero writes: the GUI never mutates `~/.agent-teams/` or invokes orchestrator commands.
5. Ship as a native Tauri desktop app built alongside the existing monorepo.

## Non-goals (explicit)

- Search / filter / date range UI
- `events.jsonl` timeline replay (tool calls, agent messages)
- Re-running, re-summarizing, cancelling, or deleting tasks
- Editing `agent-team.yaml` from the GUI
- Theme switching (dark-only for MVP)
- Multiple simultaneous windows / detaching a report as its own window
- Code signing / notarization (developer build only)

## User experience

### Entry clarifications (from brainstorming)

- Primary purpose: **read-only report viewer** (not a live dashboard, not a control center — cmux still owns live observation).
- Detail depth: **summary + per-agent `report.md`** (no `events.jsonl` replay).
- In-progress behaviour: **show running tasks with progress, auto-update on completion** — but don't stream the raw event feed.
- Layout: **three-pane IDE style** (task list | agent list | report body).

### Main window layout

```
┌───────────────┬───────────────┬──────────────────────────────┐
│ Tasks         │ Agents        │  Report                      │
│ (latest 100)  │ (for current  │  (Markdown render)           │
│               │  task)        │                              │
│ • README typo │ • Summary     │  # README typo fix           │
│   ✓ done 2m   │ • Lin · docs  │                              │
│ • Add auth mw │   ✓           │  ## What was done            │
│   ⟳ 2/3  5m   │               │  Fixed line 42 typo…         │
│ • Refactor … │                │                              │
│   ✓ 1h        │                │  — Lin                       │
│ • Fix cmux …  │                │                              │
│   ✗ failed    │                │                              │
└───────────────┴───────────────┴──────────────────────────────┘
```

- **Left pane (Tasks)** — one row per task. Row contents: truncated description, status badge, relative time. Clicking selects the task.
- **Middle pane (Agents)** — shows a fixed `Summary` entry plus one entry per sub-task (agent name + role + status icon). Clicking switches the right pane.
- **Right pane (Report)** — renders the selected Markdown document. If the selected sub-task is still `running` and `report.md` does not exist yet, renders a subtle placeholder rather than throwing.

### Status model

| status | source | visual |
| --- | --- | --- |
| `planning` | `tasks.status` during triage/plan (task-level only) | grey spinner |
| `running` | `tasks.status` or `sub_tasks.status` | amber spinner |
| `completed` | terminal state, all workers succeeded | green check |
| `failed` | any worker failed or orchestrator error | red cross |
| `partial` | **GUI-synthesized**: `tasks.status = completed` AND any `sub_tasks.status = failed` | amber check |

The storage schema (see `packages/storage/src/db.ts`) defines `TaskStatus = "planning" | "running" | "completed" | "failed"` and `SubTaskStatus = "pending" | "running" | "completed" | "failed"` — no `partial` in the DB. The GUI derives `partial` in the Rust mapper when composing `TaskDetail`. Sub-task rows only ever use the four DB values; `planning` is task-level only.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Tauri Desktop App  (packages/gui/)                       │
│                                                          │
│  ┌────────────────────┐       ┌──────────────────────┐  │
│  │  Frontend (webview)│ <IPC> │  Rust backend        │  │
│  │  React + Vite + TS │invoke │  • rusqlite (ro)     │  │
│  │  Tailwind CSS      │ emit  │  • notify (fs watch) │  │
│  │  react-markdown    │       │  • serde_json        │  │
│  └────────────────────┘       └──────────┬───────────┘  │
└──────────────────────────────────────────┼──────────────┘
                                           │ read-only
                                           ▼
                              ~/.agent-teams/
                              ├── db.sqlite  (WAL — safe concurrent read)
                              └── tasks/<id>/ (summary.md, agents/*/report.md)
```

### Why this shape

- **Rust + rusqlite** (option A from brainstorming) over an embedded Node sidecar or an `exec agent-teams list` shell-out. Single binary, fast cold start, no runtime to ship. Trade-off accepted: the SQLite schema is defined twice (once in `packages/storage/src/db.ts` as the source of truth, once in `packages/gui/src-tauri/src/db.rs` as a read-only mirror). Orchestrator owns migrations; GUI only queries.
- **Read-only SQLite open is load-bearing.** `db.rs` opens the connection with `rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY` (no `CREATE`, no `READ_WRITE`). This is the mechanism that enforces the "zero writes" guarantee — a misconfigured query cannot mutate the orchestrator's database.
- **WAL mode is already on** in the storage package, so orchestrator writes and GUI reads coexist safely.
- **`notify` crate** for filesystem watching of `~/.agent-teams/tasks/` — the file-creation event for `summary.md` / `report.md` is a more reliable "done" signal than polling SQLite alone.

### Package layout

```
packages/gui/
├── package.json            # @agent-teams/gui, scripts: dev / build / tauri
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/                    # React
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── TaskList.tsx
│   │   ├── TaskListItem.tsx
│   │   ├── AgentSidebar.tsx
│   │   ├── ReportView.tsx
│   │   ├── StatusBadge.tsx
│   │   └── EmptyState.tsx
│   └── lib/
│       ├── ipc.ts          # invoke/listen wrappers with TS types
│       └── types.ts
└── src-tauri/              # Rust
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        ├── main.rs
        ├── db.rs
        ├── reports.rs
        ├── watcher.rs
        └── models.rs
```

## Components

### Frontend

- `App.tsx` — owns three pieces of top-level state: `selectedTaskId`, `selectedReportKind` (`"summary"` or a `sub_task_id`), and a `generation` counter bumped on `tasks-changed` events to invalidate memoised fetches.
- `TaskList` / `TaskListItem` — pure rendering from props, no data fetching of its own. Shows description (truncated to one line), `StatusBadge`, and a relative timestamp (`2m` / `5h` / `3d`).
- `AgentSidebar` — given the current task detail, renders `Summary` + `SubTask[]`. Each row shows `<name> · <role>` and a status icon.
- `ReportView` — feeds the report string into `react-markdown` with `remark-gfm`. Code blocks get syntax highlighting via `rehype-highlight` (light theme pack). Renders a placeholder when report is missing.
- `StatusBadge` — pure function of status → icon + color.
- `EmptyState` — shown when no task is selected, or when a selected `running` sub-task has no report yet.

### Backend (Rust)

All Tauri `#[command]` handlers return `Result<T, String>`; the `String` is a user-facing error label.

- `list_tasks(limit: u32, offset: u32) -> Vec<Task>`
- `get_task_detail(task_id: String) -> TaskDetail`
- `get_report(task_id: String, kind: ReportKind) -> Option<String>` where `ReportKind = Summary | SubTask(String)`
- A single watcher task, spawned in `main.rs` setup hook, watches `~/.agent-teams/tasks/` recursively and the db file directly. Debounces events (500 ms) and emits `tasks-changed` with a `{ task_id: Option<String> }` payload (`None` when the db itself changed — triggers a full list refresh).

### IPC summary

| kind | name | args | returns |
| --- | --- | --- | --- |
| command | `list_tasks` | `{ limit, offset }` | `Task[]` |
| command | `get_task_detail` | `task_id` | `TaskDetail` |
| command | `get_report` | `{ task_id, kind }` | `string \| null` |
| event | `tasks-changed` | — | `{ task_id: string \| null }` |

`TaskDetail` is the single canonical return shape for the detail command. It is defined once in `packages/gui/src/lib/types.ts` (TS) mirroring the Rust struct in `models.rs` (serde). No inline anonymous shapes elsewhere.

`ReportKind` is serialized as an **externally tagged** serde enum so the TypeScript caller sends either the string `"summary"` or `{ subTask: "<sub_task_ulid>" }`:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum ReportKind {
    Summary,
    SubTask(String),
}
```

```ts
type ReportKind = "summary" | { subTask: string };
```

The rename rule turns `Summary` into the plain string `"summary"` and `SubTask("abc")` into `{ "subTask": "abc" }`. This keeps the wire format stable and lets the TS side use a cheap discriminated union.

## Data flow

### Startup

1. `App.tsx` mounts, calls `invoke("list_tasks", { limit: 100, offset: 0 })`.
2. Rust setup hook spawns the `notify` watcher on `~/.agent-teams/tasks/` and `~/.agent-teams/db.sqlite` before the window shows.
3. `TaskList` renders; middle and right panes show `EmptyState`.

### Selecting a task

1. Click on `TaskListItem` → `selectedTaskId` updates.
2. `useEffect` on `selectedTaskId` → `invoke("get_task_detail", taskId)` → drives `AgentSidebar`. Default `selectedReportKind = "summary"`.
3. Parallel `invoke("get_report", { task_id, kind: "summary" })` → `ReportView`.

### Switching the right-pane document

1. Click on a sidebar row → `selectedReportKind` updates.
2. `invoke("get_report", …)` → render.
3. If the sub-task is `running` and the report returned is `null`, show the "not yet written" placeholder.

### Live updates

1. Orchestrator or worker writes a file under `~/.agent-teams/tasks/` or commits a DB update.
2. `notify` watcher fires, debounces 500 ms, and emits `tasks-changed` with an extracted `task_id` (or `null` for DB-only changes).
3. Frontend `listen("tasks-changed")` handler:
   - Always bumps `generation` to refresh the task list.
   - If the changed `task_id` matches `selectedTaskId`, also re-fetches `get_task_detail` and the current `get_report`.

### Error paths

- DB not present → `list_tasks` returns empty. TaskList shows a first-run hint pointing at `/team`.
- `report.md` missing → `get_report` returns `null`; placeholder.
- Task is `failed` with no `summary.md` → Summary tab shows a "summarizer did not complete" message and references the `planner-events.jsonl` / `triage-events.jsonl` paths for manual inspection. Note: `packages/storage/src/paths.ts` currently exposes helpers only for `summaryFile` / `reportFile` / `eventsFile` (the worker-level JSONL). The GUI's `reports.rs` will construct the planner/triage/summarizer JSONL paths itself using the known `<task-dir>/{planner,triage,summarizer}-events.jsonl` convention — no new helper is required in the storage package for MVP, but the path construction is documented in `reports.rs` so it stays discoverable.
- `SQLITE_BUSY` → Rust retries 3 times with 50 / 150 / 400 ms backoff, then surfaces `"database busy"` which the frontend shows as a dismissable red banner.
- Watcher setup failure → fall back to 30 s interval polling and surface a `"⚠ watcher fallback"` badge in the header so the user knows live updates are coarser.
- Report > `MAX_REPORT_BYTES` (1 MiB, defined as a `const` in `reports.rs`) → Rust truncates and appends a `"(showing N KB of X KB)"` footer. The threshold is a single point of tuning, not a magic number scattered through the module.

## Testing

- **Rust** — `cargo test` covers `db.rs` (in-memory SQLite fixture exercising `list_tasks` / `get_task_detail`) and `reports.rs` (tmpdir fixture for summary / report / missing-file paths). Keep this tight — one or two tests per module, MVP scope.
- **Frontend** — Vitest + React Testing Library. One snapshot-level test for `TaskList` rendering multiple status rows, one for `ReportView` rendering a markdown sample and its placeholder. Do not test IPC wiring in unit tests; rely on manual e2e.
- **e2e** — manual. Run `/team "…"` a couple of times to populate `~/.agent-teams/tasks/`, then `pnpm --filter @agent-teams/gui tauri dev`. Verify:
  1. Task list populates, most recent on top.
  2. Running task shows live status update when cmux workers complete.
  3. Summary and each agent's report render; switching is snappy.
  4. Killing the orchestrator mid-run leaves the task in `running`; GUI stays stable.
  5. Deleting `~/.agent-teams/db.sqlite` → GUI shows the first-run state rather than crashing.

## Distribution

- `packages/gui/` participates in the pnpm monorepo. `pnpm -r build` continues to build only the TS packages; Tauri builds are explicit via `pnpm --filter @agent-teams/gui tauri build`.
- `setup.sh` gets an optional `--with-gui` flag: when present, it runs `pnpm --filter @agent-teams/gui tauri build` and drops the resulting `.app` under `dist-gui/`. The flag is off by default to keep bare-bones setup fast.
- MVP is developer-build only — no code signing, no notarization, no auto-update channel. Users open the `.app` with `open -a` or by double-click after a one-time Gatekeeper override.

## Out-of-scope, revisit later

- `events.jsonl` timeline replay (tool calls + agent messages interleaved).
- Search / filter / date ranges on the task list.
- Re-running a failed task from the GUI.
- Pinning / favouriting tasks, or grouping by team.
- Signed, notarized builds with an auto-update channel.
- Multi-repo workspace support (matches agent-teams MVP — the CLI itself doesn't support workspaces yet).

## Open questions (for implementation plan)

- Exact `notify` debounce interval — 500 ms is a reasonable default; may need tuning if the user runs very short tasks back-to-back.
- Whether to ship a single combined SQLite + fs-watch event channel or two separate channels. The design assumes one (`tasks-changed`) with a nullable `task_id`, which simplifies the frontend.

## Fixed decisions (previously open, now resolved)

- **Tauri version: v2.** The design's use of the setup hook, `invoke`, and `listen` API all assume v2. No v1 fallback.
