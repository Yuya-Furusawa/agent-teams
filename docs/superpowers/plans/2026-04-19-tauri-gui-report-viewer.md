# Tauri GUI: Agent-Teams Report Viewer — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only Tauri v2 desktop app that lets the user browse past and in-progress `agent-teams` tasks, viewing each task's summary and per-worker reports in a 3-pane IDE-style layout.

**Architecture:** `packages/gui/` pnpm-workspace package with a React + Vite + Tailwind webview and a Rust (`src-tauri/`) backend. Rust reads `~/.agent-teams/db.sqlite` via `rusqlite` opened with `SQLITE_OPEN_READ_ONLY`, watches `~/.agent-teams/tasks/` with the `notify` crate, and exposes three Tauri commands (`list_tasks`, `get_task_detail`, `get_report`) plus one event (`tasks-changed`). The frontend holds minimal state (`selectedTaskId`, `selectedReportKind`, `generation`) and re-fetches when the Rust side emits change events.

**Tech Stack:** Tauri v2, Rust (rusqlite, notify, serde, tokio), React 18, Vite, TypeScript, Tailwind CSS, react-markdown (with remark-gfm and rehype-highlight), Vitest, React Testing Library.

**Reference spec:** [`/Users/yuyafurusawa/Works/agent-teams/docs/superpowers/specs/2026-04-19-tauri-gui-report-viewer-design.md`](../specs/2026-04-19-tauri-gui-report-viewer-design.md)

**Repository state when plan begins:** monorepo at `/Users/yuyafurusawa/Works/agent-teams` with `packages/{cli,orchestrator,agent-runner,cmux-adapter,storage}/`. `~/.agent-teams/db.sqlite` exists from prior `/team` runs so the GUI has real data to query. No `packages/gui/` yet.

---

## Chunk 1: Scaffold the `packages/gui/` workspace

This chunk lays the monorepo plumbing: the pnpm package, the TS/Vite/Tailwind toolchain, and the empty Tauri v2 shell. After it completes, `pnpm --filter @agent-teams/gui tauri dev` opens an empty window.

### Task 1.1: Create the package directory and baseline files

**Files:**
- Create: `packages/gui/package.json`
- Create: `packages/gui/tsconfig.json`
- Create: `packages/gui/index.html`
- Create: `packages/gui/vite.config.ts`
- Create: `packages/gui/postcss.config.js`
- Create: `packages/gui/tailwind.config.js`
- Create: `packages/gui/src/main.tsx`
- Create: `packages/gui/src/App.tsx`
- Create: `packages/gui/src/styles.css`

- [ ] **Step 1: Create `packages/gui/package.json`**

```json
{
  "name": "@agent-teams/gui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-markdown": "^9.0.1",
    "rehype-highlight": "^7.0.0",
    "remark-gfm": "^4.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.6.2",
    "vite": "^5.4.5",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `packages/gui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals"],
    "composite": false,
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 3: Create `packages/gui/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>agent-teams</title>
  </head>
  <body class="bg-neutral-950 text-neutral-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `packages/gui/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

- [ ] **Step 5: Create `packages/gui/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create `packages/gui/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ok: "#4ade80",
        warn: "#fbbf24",
        bad: "#ef4444",
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 7: Create `packages/gui/src/styles.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html, body, #root { height: 100%; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
}
```

- [ ] **Step 8: Create `packages/gui/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 9: Create `packages/gui/src/App.tsx` (placeholder shell)**

```tsx
export function App(): JSX.Element {
  return (
    <div className="h-full w-full flex items-center justify-center text-neutral-500">
      agent-teams GUI — bootstrap
    </div>
  );
}
```

- [ ] **Step 10: Register the package in the workspace**

Append `packages/gui` to the workspace if it isn't picked up by the glob already. The root `pnpm-workspace.yaml` uses `packages/*` so the new directory is discovered automatically — verify with:

```bash
pnpm ls --depth 0 -r | grep "@agent-teams/gui"
```

Expected: one line with `@agent-teams/gui 0.0.0`.

- [ ] **Step 11: Install dependencies**

```bash
pnpm install
```

Expected: success, no peer warnings beyond the usual monorepo ones.

- [ ] **Step 12: Commit**

```bash
git add packages/gui/package.json packages/gui/tsconfig.json packages/gui/index.html \
        packages/gui/vite.config.ts packages/gui/postcss.config.js packages/gui/tailwind.config.js \
        packages/gui/src/main.tsx packages/gui/src/App.tsx packages/gui/src/styles.css \
        pnpm-lock.yaml
git commit -m "gui: scaffold @agent-teams/gui package (React + Vite + Tailwind)"
```

### Task 1.2: Add the Tauri v2 Rust shell

**Files:**
- Create: `packages/gui/src-tauri/Cargo.toml`
- Create: `packages/gui/src-tauri/tauri.conf.json`
- Create: `packages/gui/src-tauri/build.rs`
- Create: `packages/gui/src-tauri/src/main.rs`
- Create: `packages/gui/src-tauri/icons/.gitkeep`

- [ ] **Step 1: Create `packages/gui/src-tauri/Cargo.toml`**

```toml
[package]
name = "agent-teams-gui"
version = "0.0.0"
edition = "2021"
rust-version = "1.75"

[lib]
name = "agent_teams_gui_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.31", features = ["bundled"] }
notify = "6"
notify-debouncer-full = "0.3"
anyhow = "1"
thiserror = "1"
dirs = "5"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Create `packages/gui/src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "agent-teams",
  "version": "0.0.0",
  "identifier": "sh.agent-teams.gui",
  "build": {
    "beforeDevCommand": "pnpm --filter @agent-teams/gui dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm --filter @agent-teams/gui build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "agent-teams",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 500
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": []
  }
}
```

- [ ] **Step 3: Create `packages/gui/src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 4: Create `packages/gui/src-tauri/src/main.rs` (minimal)**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Smoke-test the shell**

```bash
pnpm --filter @agent-teams/gui tauri dev
```

Expected: Tauri compiles (first run ~5 minutes), dev window opens showing the "bootstrap" text. Quit with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add packages/gui/src-tauri/Cargo.toml packages/gui/src-tauri/tauri.conf.json \
        packages/gui/src-tauri/build.rs packages/gui/src-tauri/src/main.rs \
        packages/gui/src-tauri/icons/.gitkeep packages/gui/src-tauri/Cargo.lock
git commit -m "gui: add Tauri v2 Rust shell"
```

---

## Chunk 2: Rust backend — models, DB, reports

Three files that turn `~/.agent-teams/` into typed data. TDD throughout — each module gets a test that pins its behaviour before the production code.

### Task 2.1: Define shared types in `models.rs`

**Files:**
- Create: `packages/gui/src-tauri/src/models.rs`
- Modify: `packages/gui/src-tauri/src/main.rs`

- [ ] **Step 1: Write the types**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub description: String,
    pub team_name: String,
    pub status: String,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub sub_task_count: u32,
    pub completed_sub_task_count: u32,
    pub failed_sub_task_count: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubTask {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub assigned_agent: String,
    pub status: String,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    pub task: Task,
    pub sub_tasks: Vec<SubTask>,
    /// GUI-synthesized. `"partial"` when task.status == "completed" and any
    /// sub_task.status == "failed". Otherwise mirrors task.status.
    pub effective_status: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReportKind {
    Summary,
    SubTask(String),
}

pub fn effective_status(task_status: &str, sub_tasks: &[SubTask]) -> String {
    if task_status == "completed" && sub_tasks.iter().any(|s| s.status == "failed") {
        "partial".to_string()
    } else {
        task_status.to_string()
    }
}
```

- [ ] **Step 2: Wire the module into `main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod models;

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Add the `effective_status` unit test**

Append to `models.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn mk_sub(status: &str) -> SubTask {
        SubTask {
            id: "s".into(),
            task_id: "t".into(),
            title: "".into(),
            assigned_agent: "".into(),
            status: status.into(),
            created_at: 0,
            completed_at: None,
        }
    }

    #[test]
    fn completed_with_failed_subtask_becomes_partial() {
        let subs = vec![mk_sub("completed"), mk_sub("failed")];
        assert_eq!(effective_status("completed", &subs), "partial");
    }

    #[test]
    fn completed_with_all_completed_stays_completed() {
        let subs = vec![mk_sub("completed"), mk_sub("completed")];
        assert_eq!(effective_status("completed", &subs), "completed");
    }

    #[test]
    fn running_task_is_never_partial() {
        let subs = vec![mk_sub("failed")];
        assert_eq!(effective_status("running", &subs), "running");
    }
}
```

- [ ] **Step 4: Run the test**

```bash
cd packages/gui/src-tauri && cargo test effective_status
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/gui/src-tauri/src/models.rs packages/gui/src-tauri/src/main.rs
git commit -m "gui: add backend data models and effective_status derivation"
```

### Task 2.2: Read-only DB access in `db.rs`

**Files:**
- Create: `packages/gui/src-tauri/src/db.rs`
- Modify: `packages/gui/src-tauri/src/main.rs`

- [ ] **Step 1: Write the failing test first**

Create `packages/gui/src-tauri/src/db.rs`:

```rust
use crate::models::{SubTask, Task, TaskDetail, effective_status};
use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use std::thread::sleep;
use std::time::Duration;

const BUSY_BACKOFFS_MS: &[u64] = &[50, 150, 400];

pub struct Db {
    path: std::path::PathBuf,
}

impl Db {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    fn open(&self) -> Result<Connection> {
        let mut last_err: Option<rusqlite::Error> = None;
        for &backoff in std::iter::once(&0u64).chain(BUSY_BACKOFFS_MS.iter()) {
            if backoff > 0 { sleep(Duration::from_millis(backoff)); }
            match Connection::open_with_flags(
                &self.path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            ) {
                Ok(c) => return Ok(c),
                Err(e) => last_err = Some(e),
            }
        }
        Err(last_err.map(anyhow::Error::from).unwrap_or_else(|| anyhow::anyhow!("open failed")))
    }

    pub fn list_tasks(&self, limit: u32, offset: u32) -> Result<Vec<Task>> {
        let conn = self.open().context("open db")?;
        let mut stmt = conn.prepare(
            r#"
            SELECT
              t.id, t.description, t.team_name, t.status, t.created_at, t.completed_at,
              COALESCE(COUNT(s.id), 0)                                                 AS sub_count,
              COALESCE(SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END), 0)     AS done_count,
              COALESCE(SUM(CASE WHEN s.status = 'failed'    THEN 1 ELSE 0 END), 0)     AS failed_count
            FROM tasks t
            LEFT JOIN sub_tasks s ON s.task_id = t.id
            GROUP BY t.id
            ORDER BY t.created_at DESC
            LIMIT ?1 OFFSET ?2
            "#,
        )?;
        let rows = stmt
            .query_map([limit as i64, offset as i64], |r| {
                Ok(Task {
                    id: r.get(0)?,
                    description: r.get(1)?,
                    team_name: r.get(2)?,
                    status: r.get(3)?,
                    created_at: r.get(4)?,
                    completed_at: r.get(5)?,
                    sub_task_count: r.get::<_, i64>(6)? as u32,
                    completed_sub_task_count: r.get::<_, i64>(7)? as u32,
                    failed_sub_task_count: r.get::<_, i64>(8)? as u32,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_task_detail(&self, task_id: &str) -> Result<Option<TaskDetail>> {
        let conn = self.open().context("open db")?;
        let task: Option<Task> = conn
            .query_row(
                r#"
                SELECT
                  t.id, t.description, t.team_name, t.status, t.created_at, t.completed_at,
                  COALESCE(COUNT(s.id), 0),
                  COALESCE(SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END), 0),
                  COALESCE(SUM(CASE WHEN s.status = 'failed'    THEN 1 ELSE 0 END), 0)
                FROM tasks t
                LEFT JOIN sub_tasks s ON s.task_id = t.id
                WHERE t.id = ?1
                GROUP BY t.id
                "#,
                [task_id],
                |r| {
                    Ok(Task {
                        id: r.get(0)?,
                        description: r.get(1)?,
                        team_name: r.get(2)?,
                        status: r.get(3)?,
                        created_at: r.get(4)?,
                        completed_at: r.get(5)?,
                        sub_task_count: r.get::<_, i64>(6)? as u32,
                        completed_sub_task_count: r.get::<_, i64>(7)? as u32,
                        failed_sub_task_count: r.get::<_, i64>(8)? as u32,
                    })
                },
            )
            .ok();
        let Some(task) = task else { return Ok(None); };
        let mut stmt = conn.prepare(
            r#"
            SELECT id, task_id, title, assigned_agent, status, created_at, completed_at
            FROM sub_tasks
            WHERE task_id = ?1
            ORDER BY created_at ASC
            "#,
        )?;
        let sub_tasks = stmt
            .query_map([task_id], |r| {
                Ok(SubTask {
                    id: r.get(0)?,
                    task_id: r.get(1)?,
                    title: r.get(2)?,
                    assigned_agent: r.get(3)?,
                    status: r.get(4)?,
                    created_at: r.get(5)?,
                    completed_at: r.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let effective = effective_status(&task.status, &sub_tasks);
        Ok(Some(TaskDetail { task, sub_tasks, effective_status: effective }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::TempDir;

    fn fixture(dir: &TempDir) -> std::path::PathBuf {
        let path = dir.path().join("db.sqlite");
        let c = Connection::open(&path).unwrap();
        c.execute_batch(
            r#"
            CREATE TABLE tasks (id TEXT PRIMARY KEY, description TEXT NOT NULL, cwd TEXT NOT NULL,
              team_name TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER);
            CREATE TABLE sub_tasks (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL,
              prompt TEXT NOT NULL, assigned_agent TEXT NOT NULL, status TEXT NOT NULL,
              created_at INTEGER NOT NULL, completed_at INTEGER);
            INSERT INTO tasks VALUES ('t1', 'desc one', '/w', 'default', 'completed', 1000, 2000);
            INSERT INTO tasks VALUES ('t2', 'desc two', '/w', 'default', 'running',   3000, NULL);
            INSERT INTO sub_tasks VALUES ('s1a', 't1', 'one', '', 'Lin', 'completed', 1000, 1500);
            INSERT INTO sub_tasks VALUES ('s1b', 't1', 'two', '', 'Kai', 'failed',    1100, 1600);
            INSERT INTO sub_tasks VALUES ('s2a', 't2', 'a',   '', 'Kai', 'running',   3100, NULL);
            "#,
        )
        .unwrap();
        path
    }

    #[test]
    fn list_tasks_returns_newest_first_with_counts() {
        let dir = TempDir::new().unwrap();
        let db = Db::new(fixture(&dir));
        let tasks = db.list_tasks(10, 0).unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].id, "t2");
        assert_eq!(tasks[0].sub_task_count, 1);
        assert_eq!(tasks[1].id, "t1");
        assert_eq!(tasks[1].sub_task_count, 2);
        assert_eq!(tasks[1].failed_sub_task_count, 1);
    }

    #[test]
    fn get_task_detail_marks_completed_with_failure_as_partial() {
        let dir = TempDir::new().unwrap();
        let db = Db::new(fixture(&dir));
        let d = db.get_task_detail("t1").unwrap().unwrap();
        assert_eq!(d.effective_status, "partial");
        assert_eq!(d.sub_tasks.len(), 2);
    }

    #[test]
    fn get_task_detail_missing_returns_none() {
        let dir = TempDir::new().unwrap();
        let db = Db::new(fixture(&dir));
        assert!(db.get_task_detail("nope").unwrap().is_none());
    }
}
```

- [ ] **Step 2: Wire the module into `main.rs`**

Replace the previous `mod models;` block:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod models;

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Run the tests**

```bash
cd packages/gui/src-tauri && cargo test --lib db::
```

Expected: `3 passed`.

- [ ] **Step 4: Commit**

```bash
git add packages/gui/src-tauri/src/db.rs packages/gui/src-tauri/src/main.rs packages/gui/src-tauri/Cargo.lock
git commit -m "gui: add read-only SQLite accessor with list_tasks / get_task_detail"
```

### Task 2.3: Filesystem readers in `reports.rs`

**Files:**
- Create: `packages/gui/src-tauri/src/reports.rs`
- Modify: `packages/gui/src-tauri/src/main.rs`

- [ ] **Step 1: Create the module with tests first**

```rust
use anyhow::Result;
use std::fs;
use std::path::{Path, PathBuf};

pub const MAX_REPORT_BYTES: usize = 1024 * 1024; // 1 MiB

pub struct Reports {
    root: PathBuf,
}

impl Reports {
    pub fn new(home: impl AsRef<Path>) -> Self {
        Self { root: home.as_ref().join("tasks") }
    }

    pub fn summary(&self, task_id: &str) -> Result<Option<String>> {
        read_capped(&self.root.join(task_id).join("summary.md"))
    }

    pub fn worker_report(&self, task_id: &str, sub_task_id: &str) -> Result<Option<String>> {
        read_capped(
            &self.root
                .join(task_id)
                .join("agents")
                .join(sub_task_id)
                .join("report.md"),
        )
    }

    /// Known-by-convention supplementary file paths. Documented here so the
    /// failure-state UI can point the user at them even though the storage
    /// package does not currently expose helpers for them.
    pub fn supplementary_paths(&self, task_id: &str) -> SupplementaryPaths {
        let base = self.root.join(task_id);
        SupplementaryPaths {
            planner_events: base.join("planner-events.jsonl"),
            triage_events: base.join("triage-events.jsonl"),
            summarizer_events: base.join("summarizer-events.jsonl"),
        }
    }
}

pub struct SupplementaryPaths {
    pub planner_events: PathBuf,
    pub triage_events: PathBuf,
    pub summarizer_events: PathBuf,
}

fn read_capped(path: &Path) -> Result<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }
    let meta = fs::metadata(path)?;
    let size = meta.len() as usize;
    if size <= MAX_REPORT_BYTES {
        return Ok(Some(fs::read_to_string(path)?));
    }
    let raw = fs::read(path)?;
    let kept = &raw[..MAX_REPORT_BYTES];
    let mut s = String::from_utf8_lossy(kept).into_owned();
    let shown_kb = MAX_REPORT_BYTES / 1024;
    let total_kb = size / 1024;
    s.push_str(&format!(
        "\n\n---\n\n_(showing {} KB of {} KB — file was truncated for display)_\n",
        shown_kb, total_kb
    ));
    Ok(Some(s))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup(dir: &TempDir) -> Reports {
        let home = dir.path();
        fs::create_dir_all(home.join("tasks/t1/agents/s1")).unwrap();
        fs::write(home.join("tasks/t1/summary.md"), "# summary body").unwrap();
        fs::write(home.join("tasks/t1/agents/s1/report.md"), "hello from Kai").unwrap();
        Reports::new(home)
    }

    #[test]
    fn summary_returns_content_when_present() {
        let dir = TempDir::new().unwrap();
        let r = setup(&dir);
        assert_eq!(r.summary("t1").unwrap().as_deref(), Some("# summary body"));
    }

    #[test]
    fn worker_report_returns_none_when_missing() {
        let dir = TempDir::new().unwrap();
        let r = setup(&dir);
        assert!(r.worker_report("t1", "missing").unwrap().is_none());
    }

    #[test]
    fn large_report_is_truncated_with_footer() {
        let dir = TempDir::new().unwrap();
        let home = dir.path();
        fs::create_dir_all(home.join("tasks/big/agents/s1")).unwrap();
        let big = "x".repeat(MAX_REPORT_BYTES + 1024);
        fs::write(home.join("tasks/big/agents/s1/report.md"), &big).unwrap();
        let r = Reports::new(home);
        let got = r.worker_report("big", "s1").unwrap().unwrap();
        assert!(got.contains("showing"), "expected truncation footer, got tail: {}", &got[got.len().saturating_sub(200)..]);
        assert!(got.len() < big.len());
    }
}
```

- [ ] **Step 2: Wire `reports` into `main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod models;
mod reports;

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Run the tests**

```bash
cd packages/gui/src-tauri && cargo test --lib reports::
```

Expected: `3 passed`.

- [ ] **Step 4: Commit**

```bash
git add packages/gui/src-tauri/src/reports.rs packages/gui/src-tauri/src/main.rs
git commit -m "gui: add markdown readers with 1 MiB cap + supplementary path helpers"
```

---

## Chunk 3: Rust backend — watcher + commands wiring

Ties `db.rs` and `reports.rs` to Tauri with three commands, one filesystem watcher, and one emitted event.

### Task 3.1: Filesystem watcher in `watcher.rs`

**Files:**
- Create: `packages/gui/src-tauri/src/watcher.rs`

- [ ] **Step 1: Write the watcher**

```rust
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const DEBOUNCE_MS: u64 = 500;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TasksChangedPayload {
    /// `None` → something changed that we could not attribute to a single task
    /// (e.g. the SQLite WAL advanced, or a file under a task whose id we
    /// couldn't parse). Frontend should refresh the task list regardless.
    pub task_id: Option<String>,
}

pub fn spawn(app: AppHandle, home: PathBuf) {
    thread::spawn(move || {
        // Make sure the tasks dir exists so `watch` does not fail on a fresh
        // install that has never run `/team`. This is the only mutation the
        // GUI performs on ~/.agent-teams/ — a directory create is harmless
        // and does not violate the read-only guarantee around the DB file.
        let tasks_dir = home.join("tasks");
        if let Err(e) = fs::create_dir_all(&tasks_dir) {
            eprintln!("create tasks dir failed: {e}; falling back to polling");
            fallback_poll(app);
            return;
        }

        let (tx, rx) = channel();
        let mut debouncer = match new_debouncer(Duration::from_millis(DEBOUNCE_MS), None, tx) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("watcher init failed: {e}; falling back to polling");
                fallback_poll(app);
                return;
            }
        };

        let db_path = home.join("db.sqlite");
        if let Err(e) = debouncer
            .watcher()
            .watch(&tasks_dir, RecursiveMode::Recursive)
        {
            eprintln!("watch {} failed: {e}; falling back to polling", tasks_dir.display());
            fallback_poll(app);
            return;
        }
        // The db file may not exist yet on a totally fresh install — this
        // watch is best-effort. `tasks/` changes still cover the common case.
        if let Err(e) = debouncer
            .watcher()
            .watch(&db_path, RecursiveMode::NonRecursive)
        {
            eprintln!("watch db failed: {e} (non-fatal)");
        }

        // Ownership of `debouncer` is held by this thread; dropping would stop
        // watching, so we keep it bound for the full rx loop lifetime.
        for res in rx {
            handle_event(&app, &tasks_dir, res);
        }
        drop(debouncer);
    });
}

fn handle_event(app: &AppHandle, tasks_dir: &Path, res: DebounceEventResult) {
    let Ok(events) = res else { return; };
    let mut task_ids = std::collections::BTreeSet::<String>::new();
    let mut had_unattributed = false;
    for ev in events {
        for path in &ev.paths {
            match extract_task_id(path, tasks_dir) {
                Some(id) => {
                    task_ids.insert(id);
                }
                None => had_unattributed = true,
            }
        }
    }
    for id in task_ids {
        let _ = app.emit("tasks-changed", TasksChangedPayload { task_id: Some(id) });
    }
    if had_unattributed {
        let _ = app.emit("tasks-changed", TasksChangedPayload { task_id: None });
    }
}

fn extract_task_id(path: &Path, tasks_dir: &Path) -> Option<String> {
    let rel = path.strip_prefix(tasks_dir).ok()?;
    rel.components().next().and_then(|c| match c {
        std::path::Component::Normal(os) => os.to_str().map(String::from),
        _ => None,
    })
}

fn fallback_poll(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(30));
        let _ = app.emit("tasks-changed", TasksChangedPayload { task_id: None });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn extract_task_id_finds_first_segment() {
        let tasks = PathBuf::from("/h/tasks");
        let p = PathBuf::from("/h/tasks/01J/agents/s1/report.md");
        assert_eq!(extract_task_id(&p, &tasks).as_deref(), Some("01J"));
    }

    #[test]
    fn extract_task_id_none_for_unrelated_path() {
        let tasks = PathBuf::from("/h/tasks");
        let p = PathBuf::from("/other/file");
        assert_eq!(extract_task_id(&p, &tasks), None);
    }
}
```

- [ ] **Step 2: Add the module to `main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod models;
mod reports;
mod watcher;

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/gui/src-tauri && cargo test --lib watcher::
```

Expected: `2 passed`.

- [ ] **Step 4: Commit**

```bash
git add packages/gui/src-tauri/src/watcher.rs packages/gui/src-tauri/src/main.rs packages/gui/src-tauri/Cargo.lock
git commit -m "gui: add debounced fs watcher that emits tasks-changed"
```

### Task 3.2: Tauri commands + state + setup hook

**Files:**
- Modify: `packages/gui/src-tauri/src/main.rs`

- [ ] **Step 1: Replace `main.rs` with the fully wired version**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod models;
mod reports;
mod watcher;

use crate::db::Db;
use crate::models::{ReportKind, Task, TaskDetail};
use crate::reports::Reports;
use std::path::PathBuf;
use tauri::{Manager, State};

struct AppState {
    db: Db,
    reports: Reports,
}

fn agent_teams_home() -> PathBuf {
    if let Ok(v) = std::env::var("AGENT_TEAMS_HOME") {
        return PathBuf::from(v);
    }
    dirs::home_dir()
        .expect("no home dir")
        .join(".agent-teams")
}

fn db_path(home: &std::path::Path) -> PathBuf {
    std::env::var("AGENT_TEAMS_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join("db.sqlite"))
}

#[tauri::command]
async fn list_tasks(
    state: State<'_, AppState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<Task>, String> {
    state
        .db
        .list_tasks(limit.unwrap_or(100), offset.unwrap_or(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_task_detail(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Option<TaskDetail>, String> {
    state.db.get_task_detail(&task_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_report(
    state: State<'_, AppState>,
    task_id: String,
    kind: ReportKind,
) -> Result<Option<String>, String> {
    match kind {
        ReportKind::Summary => state.reports.summary(&task_id).map_err(|e| e.to_string()),
        ReportKind::SubTask(sub) => state
            .reports
            .worker_report(&task_id, &sub)
            .map_err(|e| e.to_string()),
    }
}

fn main() {
    let home = agent_teams_home();
    let db = Db::new(db_path(&home));
    let reports = Reports::new(&home);

    tauri::Builder::default()
        .manage(AppState { db, reports })
        .setup({
            let home = home.clone();
            move |app| {
                watcher::spawn(app.handle().clone(), home.clone());
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![list_tasks, get_task_detail, get_report])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Compile-check**

```bash
cd packages/gui/src-tauri && cargo build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/gui/src-tauri/src/main.rs packages/gui/src-tauri/Cargo.lock
git commit -m "gui: wire list_tasks / get_task_detail / get_report commands + watcher setup hook"
```

---

## Chunk 4: Frontend components

Build the React tree bottom-up: types and IPC wrapper first, then leaf components, finally the 3-pane `App`.

### Task 4.1: Types and IPC wrapper

**Files:**
- Create: `packages/gui/src/lib/types.ts`
- Create: `packages/gui/src/lib/ipc.ts`

- [ ] **Step 1: Create `src/lib/types.ts`**

```ts
export type TaskStatus = "planning" | "running" | "completed" | "failed";
export type EffectiveTaskStatus = TaskStatus | "partial";
export type SubTaskStatus = "pending" | "running" | "completed" | "failed";

export interface Task {
  id: string;
  description: string;
  teamName: string;
  status: TaskStatus;
  createdAt: number;
  completedAt: number | null;
  subTaskCount: number;
  completedSubTaskCount: number;
  failedSubTaskCount: number;
}

export interface SubTask {
  id: string;
  taskId: string;
  title: string;
  assignedAgent: string;
  status: SubTaskStatus;
  createdAt: number;
  completedAt: number | null;
}

export interface TaskDetail {
  task: Task;
  subTasks: SubTask[];
  effectiveStatus: EffectiveTaskStatus;
}

export type ReportKind = "summary" | { subTask: string };

export interface TasksChangedPayload {
  taskId: string | null;
}
```

- [ ] **Step 2: Create `src/lib/ipc.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ReportKind,
  Task,
  TaskDetail,
  TasksChangedPayload,
} from "./types";

export async function listTasks(limit = 100, offset = 0): Promise<Task[]> {
  return invoke<Task[]>("list_tasks", { limit, offset });
}

export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  return invoke<TaskDetail | null>("get_task_detail", { taskId });
}

export async function getReport(
  taskId: string,
  kind: ReportKind,
): Promise<string | null> {
  return invoke<string | null>("get_report", { taskId, kind });
}

export async function onTasksChanged(
  handler: (payload: TasksChangedPayload) => void,
): Promise<UnlistenFn> {
  return listen<TasksChangedPayload>("tasks-changed", (e) => handler(e.payload));
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/gui/src/lib/types.ts packages/gui/src/lib/ipc.ts
git commit -m "gui: add typed IPC wrapper matching Rust command signatures"
```

### Task 4.2: `StatusBadge` + `EmptyState`

**Files:**
- Create: `packages/gui/src/components/StatusBadge.tsx`
- Create: `packages/gui/src/components/EmptyState.tsx`

- [ ] **Step 1: Create `StatusBadge.tsx`**

```tsx
import type { EffectiveTaskStatus, SubTaskStatus } from "../lib/types";

type Status = EffectiveTaskStatus | SubTaskStatus;

const MAP: Record<Status, { label: string; className: string }> = {
  planning:  { label: "planning",  className: "text-neutral-400" },
  pending:   { label: "pending",   className: "text-neutral-400" },
  running:   { label: "running",   className: "text-warn" },
  completed: { label: "done",      className: "text-ok" },
  failed:    { label: "failed",    className: "text-bad" },
  partial:   { label: "partial",   className: "text-warn" },
};

export function StatusBadge({ status }: { status: Status }): JSX.Element {
  const { label, className } = MAP[status];
  return (
    <span className={`text-xs uppercase tracking-wide ${className}`}>{label}</span>
  );
}
```

- [ ] **Step 2: Create `EmptyState.tsx`**

```tsx
export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center text-neutral-500 gap-2">
      <div className="text-sm">{title}</div>
      {hint && <div className="text-xs text-neutral-600">{hint}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/gui/src/components/StatusBadge.tsx packages/gui/src/components/EmptyState.tsx
git commit -m "gui: add StatusBadge and EmptyState leaf components"
```

### Task 4.3: `TaskList` + `TaskListItem`

**Files:**
- Create: `packages/gui/src/components/TaskListItem.tsx`
- Create: `packages/gui/src/components/TaskList.tsx`
- Create: `packages/gui/src/lib/time.ts`
- Create: `packages/gui/src/components/TaskList.test.tsx`

- [ ] **Step 1: Create `src/lib/time.ts`**

```ts
export function relativeTime(fromMs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - fromMs);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
```

- [ ] **Step 2: Create `TaskListItem.tsx`**

```tsx
import type { Task } from "../lib/types";
import { StatusBadge } from "./StatusBadge";
import { relativeTime } from "../lib/time";

export function TaskListItem({
  task,
  selected,
  onSelect,
}: {
  task: Task;
  selected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const progress =
    task.subTaskCount > 0
      ? `${task.completedSubTaskCount}/${task.subTaskCount}`
      : "";
  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      className={`w-full text-left px-3 py-2 border-b border-neutral-800 ${
        selected ? "bg-neutral-800" : "hover:bg-neutral-900"
      }`}
    >
      <div className="text-sm text-neutral-100 truncate">{task.description}</div>
      <div className="flex items-center gap-2 text-xs mt-1">
        <StatusBadge status={task.status} />
        {progress && <span className="text-neutral-500">{progress}</span>}
        <span className="text-neutral-600 ml-auto">
          {relativeTime(task.createdAt)}
        </span>
      </div>
    </button>
  );
}
```

- [ ] **Step 3: Create `TaskList.tsx`**

```tsx
import type { Task } from "../lib/types";
import { TaskListItem } from "./TaskListItem";

export function TaskList({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  if (tasks.length === 0) {
    return (
      <div className="p-4 text-xs text-neutral-500">
        No tasks yet. Run <code className="text-neutral-300">/team &quot;...&quot;</code> in a Claude Code session to create one.
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      {tasks.map((t) => (
        <TaskListItem
          key={t.id}
          task={t}
          selected={selectedId === t.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create `TaskList.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskList } from "./TaskList";
import type { Task } from "../lib/types";

const baseTask: Task = {
  id: "t1",
  description: "fix readme",
  teamName: "default",
  status: "completed",
  createdAt: Date.now() - 120_000,
  completedAt: Date.now(),
  subTaskCount: 1,
  completedSubTaskCount: 1,
  failedSubTaskCount: 0,
};

describe("TaskList", () => {
  it("renders a hint when empty", () => {
    render(<TaskList tasks={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/No tasks yet/)).toBeTruthy();
  });

  it("calls onSelect with the clicked task id", () => {
    const onSelect = vi.fn();
    render(<TaskList tasks={[baseTask]} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("fix readme"));
    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("marks the selected row with a background class", () => {
    const { container } = render(
      <TaskList tasks={[baseTask]} selectedId="t1" onSelect={() => {}} />,
    );
    expect(container.querySelector(".bg-neutral-800")).not.toBeNull();
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @agent-teams/gui test
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/gui/src/components/TaskList.tsx packages/gui/src/components/TaskListItem.tsx \
        packages/gui/src/components/TaskList.test.tsx packages/gui/src/lib/time.ts
git commit -m "gui: add task list with status badge and relative time"
```

### Task 4.4: `AgentSidebar`

**Files:**
- Create: `packages/gui/src/components/AgentSidebar.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { ReportKind, TaskDetail } from "../lib/types";
import { StatusBadge } from "./StatusBadge";

function kindEquals(a: ReportKind, b: ReportKind): boolean {
  if (a === "summary" && b === "summary") return true;
  if (typeof a === "object" && typeof b === "object") return a.subTask === b.subTask;
  return false;
}

export function AgentSidebar({
  detail,
  selected,
  onSelect,
}: {
  detail: TaskDetail;
  selected: ReportKind;
  onSelect: (kind: ReportKind) => void;
}): JSX.Element {
  const summaryKind: ReportKind = "summary";
  return (
    <div className="h-full overflow-y-auto border-r border-neutral-800 bg-neutral-900">
      <button
        type="button"
        onClick={() => onSelect(summaryKind)}
        className={`w-full text-left px-3 py-2 border-b border-neutral-800 ${
          kindEquals(selected, summaryKind) ? "bg-neutral-800" : "hover:bg-neutral-900/80"
        }`}
      >
        <div className="text-sm font-medium">Summary</div>
        <div className="text-xs text-neutral-500 mt-0.5">
          <StatusBadge status={detail.effectiveStatus} />
        </div>
      </button>
      {detail.subTasks.map((s) => {
        const kind: ReportKind = { subTask: s.id };
        const active = kindEquals(selected, kind);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(kind)}
            className={`w-full text-left px-3 py-2 border-b border-neutral-800 ${
              active ? "bg-neutral-800" : "hover:bg-neutral-900/80"
            }`}
          >
            <div className="text-sm truncate">{s.assignedAgent}</div>
            <div className="text-xs text-neutral-500 truncate">{s.title}</div>
            <div className="mt-0.5"><StatusBadge status={s.status} /></div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/gui/src/components/AgentSidebar.tsx
git commit -m "gui: add AgentSidebar with summary + sub-task entries"
```

### Task 4.5: `ReportView`

**Files:**
- Create: `packages/gui/src/components/ReportView.tsx`
- Create: `packages/gui/src/components/ReportView.test.tsx`

- [ ] **Step 1: Create `ReportView.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { EmptyState } from "./EmptyState";

export function ReportView({
  body,
  loading,
  missingLabel,
}: {
  body: string | null;
  loading: boolean;
  missingLabel: string;
}): JSX.Element {
  if (loading) {
    return <EmptyState title="Loading…" />;
  }
  if (body === null) {
    return <EmptyState title={missingLabel} />;
  }
  return (
    <div className="h-full overflow-y-auto px-6 py-4 prose prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 2: Create `ReportView.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportView } from "./ReportView";

describe("ReportView", () => {
  it("renders markdown content", () => {
    render(<ReportView body={"# Hello"} loading={false} missingLabel="x" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hello");
  });

  it("shows missing label when body is null", () => {
    render(<ReportView body={null} loading={false} missingLabel="No report yet" />);
    expect(screen.getByText("No report yet")).toBeTruthy();
  });

  it("shows loading state", () => {
    render(<ReportView body={null} loading={true} missingLabel="No report yet" />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Add Tailwind typography plugin**

Update `packages/gui/package.json` to add `@tailwindcss/typography` devDependency:

```json
"@tailwindcss/typography": "^0.5.15",
```

Then re-run `pnpm install`.

Update `packages/gui/tailwind.config.js`:

```js
import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ok: "#4ade80",
        warn: "#fbbf24",
        bad: "#ef4444",
      },
    },
  },
  plugins: [typography],
};
```

- [ ] **Step 4: Import the highlight.js theme CSS**

Append to `packages/gui/src/styles.css`:

```css
@import "highlight.js/styles/github-dark.css";
```

And add `highlight.js` to dependencies (peer of `rehype-highlight`):

```json
"highlight.js": "^11.10.0",
```

Re-run `pnpm install`.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @agent-teams/gui test
```

Expected: 6 passed (3 ReportView + 3 TaskList).

- [ ] **Step 6: Commit**

```bash
git add packages/gui/src/components/ReportView.tsx packages/gui/src/components/ReportView.test.tsx \
        packages/gui/package.json packages/gui/tailwind.config.js packages/gui/src/styles.css \
        pnpm-lock.yaml
git commit -m "gui: add ReportView with react-markdown + syntax highlighting"
```

---

## Chunk 5: App shell wiring + distribution

Assembles the 3-pane layout, listens for live updates, then adds the optional `setup.sh --with-gui` flow.

### Task 5.1: `App.tsx` — 3-pane shell and IPC orchestration

**Files:**
- Modify: `packages/gui/src/App.tsx`

- [ ] **Step 1: Replace `App.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { TaskList } from "./components/TaskList";
import { AgentSidebar } from "./components/AgentSidebar";
import { ReportView } from "./components/ReportView";
import { EmptyState } from "./components/EmptyState";
import {
  getReport,
  getTaskDetail,
  listTasks,
  onTasksChanged,
} from "./lib/ipc";
import type { ReportKind, Task, TaskDetail } from "./lib/types";

export function App(): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [selectedKind, setSelectedKind] = useState<ReportKind>("summary");
  const [report, setReport] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const bump = useCallback(() => setGeneration((g) => g + 1), []);

  // list_tasks on mount + when generation changes
  useEffect(() => {
    listTasks()
      .then(setTasks)
      .catch((e) => setError(String(e)));
  }, [generation]);

  // get_task_detail when selection changes
  useEffect(() => {
    if (!selectedTaskId) {
      setDetail(null);
      return;
    }
    getTaskDetail(selectedTaskId)
      .then((d) => {
        setDetail(d);
        setSelectedKind("summary");
      })
      .catch((e) => setError(String(e)));
  }, [selectedTaskId, generation]);

  // get_report when selected doc changes
  useEffect(() => {
    if (!selectedTaskId) {
      setReport(null);
      return;
    }
    setReportLoading(true);
    getReport(selectedTaskId, selectedKind)
      .then(setReport)
      .catch((e) => setError(String(e)))
      .finally(() => setReportLoading(false));
  }, [selectedTaskId, selectedKind, generation]);

  // live updates
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    onTasksChanged((payload) => {
      if (payload.taskId == null || payload.taskId === selectedTaskId) {
        bump();
      } else {
        // silently refresh the list but don't touch the current detail fetch
        listTasks().then(setTasks).catch(() => {});
      }
    }).then((u) => {
      if (cancelled) { u(); return; }
      unlisten = u;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [selectedTaskId, bump]);

  const missingLabel = useMemo(() => {
    if (selectedKind === "summary") return "Summary not available yet.";
    return "Report not written yet.";
  }, [selectedKind]);

  return (
    <div className="h-full w-full grid grid-cols-[260px_220px_1fr] bg-neutral-950 text-neutral-100">
      <aside className="border-r border-neutral-800">
        <header className="px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-800 flex items-center justify-between">
          <span>Tasks</span>
          <button
            onClick={bump}
            className="text-neutral-400 hover:text-neutral-200"
            title="Refresh"
          >↻</button>
        </header>
        <TaskList tasks={tasks} selectedId={selectedTaskId} onSelect={setSelectedTaskId} />
      </aside>
      <aside>
        {detail ? (
          <AgentSidebar detail={detail} selected={selectedKind} onSelect={setSelectedKind} />
        ) : (
          <EmptyState title="Select a task" />
        )}
      </aside>
      <main className="min-w-0">
        {error && (
          <div className="bg-bad/20 text-bad text-xs px-3 py-2 border-b border-bad/40 flex items-center gap-3">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="hover:text-neutral-100">✕</button>
          </div>
        )}
        {selectedTaskId ? (
          <ReportView body={report} loading={reportLoading} missingLabel={missingLabel} />
        ) : (
          <EmptyState title="No task selected" hint="Pick a task from the left to view its summary and per-agent reports." />
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Smoke-test in dev**

Make sure at least one task exists at `~/.agent-teams/tasks/`. Then:

```bash
pnpm --filter @agent-teams/gui tauri dev
```

Expected: 3-pane window opens; task list populates; clicking shows summary; clicking an agent shows its report; refresh button re-fetches.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @agent-teams/gui test && cd packages/gui/src-tauri && cargo test --lib
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/gui/src/App.tsx
git commit -m "gui: wire 3-pane App shell with IPC + tasks-changed live updates"
```

### Task 5.2: Generate Tauri icons for bundle builds

**Files:**
- Create: `packages/gui/src-tauri/app-icon.png` (source, 1024x1024 PNG)
- Generated (committed): `packages/gui/src-tauri/icons/*` (produced by `tauri icon`)
- Modify: `packages/gui/src-tauri/tauri.conf.json`

The dev window (`tauri dev`) works without icons, but `tauri build` requires them. We generate a full icon set once from a source PNG so `./setup.sh --with-gui` works out of the box.

- [ ] **Step 1: Commit a placeholder source PNG**

Create any 1024x1024 PNG at `packages/gui/src-tauri/app-icon.png`. A minimal monogram is enough — contributors can replace it later. One-liner with ImageMagick:

```bash
magick -size 1024x1024 canvas:'#0f172a' \
  -fill '#4ade80' -gravity center -pointsize 480 -annotate +0+0 'AT' \
  packages/gui/src-tauri/app-icon.png
```

If ImageMagick is not available, any existing 1024x1024 PNG works — just copy one in.

- [ ] **Step 2: Generate the icon set**

```bash
pnpm --filter @agent-teams/gui tauri icon packages/gui/src-tauri/app-icon.png
```

Expected: `packages/gui/src-tauri/icons/` is populated with `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`, `Square30x30Logo.png`, etc.

- [ ] **Step 3: Point `tauri.conf.json` at the generated icons**

Replace the `bundle` block's `"icon": []` with:

```json
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
```

- [ ] **Step 4: Delete the `.gitkeep` placeholder and commit**

```bash
rm packages/gui/src-tauri/icons/.gitkeep
git add packages/gui/src-tauri/app-icon.png packages/gui/src-tauri/icons/ \
        packages/gui/src-tauri/tauri.conf.json
git commit -m "gui: add placeholder app icon and generated icon set for bundle builds"
```

### Task 5.3: Update `setup.sh` with optional `--with-gui` flag

**Files:**
- Modify: `setup.sh`
- Modify: `README.md`

Current `setup.sh` uses a `for arg in "$@"; do case "$arg" in ... esac done` pattern (not a long-option getopts). The exact edits below match that structure.

- [ ] **Step 1: Add `WITH_GUI` default**

Find:

```bash
DRY_RUN=0
YES=0
```

Replace with:

```bash
DRY_RUN=0
YES=0
WITH_GUI=0
```

- [ ] **Step 2: Add the flag branch**

Find the `case "$arg" in` block and insert a new branch before the `*)` catch-all:

```bash
    --with-gui) WITH_GUI=1 ;;
```

So the block becomes:

```bash
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y)  YES=1 ;;
    --with-gui) WITH_GUI=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 1
      ;;
  esac
```

- [ ] **Step 3: Insert the GUI build step**

After the existing `step "building packages"` block (line around `run "cd \"$REPO_ROOT\" && pnpm -r build"`) and before `step "marking CLI binaries executable"`, insert:

```bash
if [[ $WITH_GUI -eq 1 ]]; then
  step "building Tauri GUI"
  run "cd \"$REPO_ROOT\" && pnpm --filter @agent-teams/gui tauri build"
  if [[ -d "$REPO_ROOT/packages/gui/src-tauri/target/release/bundle" ]]; then
    run "mkdir -p \"$REPO_ROOT/dist-gui\""
    run "cp -R \"$REPO_ROOT/packages/gui/src-tauri/target/release/bundle\"/* \"$REPO_ROOT/dist-gui\"/"
  else
    echo "warning: tauri bundle directory missing — skipping copy" >&2
  fi
fi
```

- [ ] **Step 4: Update the help text**

The `-h|--help` branch reads lines 2-20 of the file. Update the usage comment at the top of `setup.sh` to include the new flag. Find:

```bash
# Usage:
#   ./setup.sh              # interactive (prompts before overwriting existing files)
#   ./setup.sh --yes        # non-interactive, overwrite existing symlinks
#   ./setup.sh --dry-run    # print actions without performing them
```

Replace with:

```bash
# Usage:
#   ./setup.sh              # interactive (prompts before overwriting existing files)
#   ./setup.sh --yes        # non-interactive, overwrite existing symlinks
#   ./setup.sh --dry-run    # print actions without performing them
#   ./setup.sh --with-gui   # also build the Tauri desktop GUI into dist-gui/
```

- [ ] **Step 5: Dry-run verify**

```bash
./setup.sh --dry-run --with-gui
```

Expected: output contains a `+ cd ... && pnpm --filter @agent-teams/gui tauri build` line under the `==> building Tauri GUI` step.

- [ ] **Step 6: Document the flag in README**

In `README.md`, add a subsection under the existing Install section (after the `Pass --yes / --dry-run` paragraph):

```markdown
### Optional: build the desktop GUI

```bash
./setup.sh --with-gui
```

Builds the Tauri report viewer in `packages/gui/` and drops the `.app` / `.dmg` bundle under `dist-gui/`. See [`docs/superpowers/specs/2026-04-19-tauri-gui-report-viewer-design.md`](docs/superpowers/specs/2026-04-19-tauri-gui-report-viewer-design.md) for scope.
```

- [ ] **Step 7: Commit**

```bash
git add setup.sh README.md
git commit -m "gui: wire --with-gui flag into setup.sh and document it"
```

### Task 5.4: Manual end-to-end verification

No code changes. The following checklist must be satisfied before considering the plan complete.

- [ ] **Step 1: Populate data**

```bash
# In a cmux + Claude Code session in a sandbox repo:
/team "add a hello-world section to the README"
# Let it finish, then start a second, leave it running:
/team "refactor the error handling in packages/cli/src/internal-worker.ts"
```

- [ ] **Step 2: Launch the GUI**

```bash
pnpm --filter @agent-teams/gui tauri dev
```

- [ ] **Step 3: Verify each requirement**

- [ ] Task list shows both tasks, newest first, with `running` and `completed` status badges
- [ ] Clicking the completed task shows Summary content; clicking an agent entry shows its report
- [ ] Clicking the running task shows `Summary not available yet.` and any already-completed sub-task report
- [ ] When the running task finishes, the list and detail refresh without manual action (watcher path)
- [ ] Deleting `~/.agent-teams/db.sqlite` and reopening the app shows the first-run hint, not a crash
- [ ] A forced large file (`dd if=/dev/urandom of=~/.agent-teams/tasks/<id>/agents/<sub>/report.md bs=1k count=2048`) renders with the truncation footer
- [ ] Fallback polling works: point the app at a temp home (`AGENT_TEAMS_HOME=/tmp/at-gui-test pnpm --filter @agent-teams/gui tauri dev`) and `chmod 000` the tasks dir before start — the stderr log should print `watch ... failed: ...; falling back to polling`, and the task list should still refresh (against the locked dir it will stay empty, but the app does not crash)

- [ ] **Step 4: Commit a verification note (optional)**

```bash
git commit --allow-empty -m "gui: manual e2e verified (list / detail / live update / fallback)"
```

---

## Done criteria

- All cargo and vitest suites pass (`cargo test --lib` + `pnpm --filter @agent-teams/gui test`).
- `pnpm --filter @agent-teams/gui tauri dev` opens a working 3-pane viewer against a populated `~/.agent-teams/`.
- `./setup.sh --with-gui` produces `dist-gui/*.app` on macOS without errors.
- No writes to `~/.agent-teams/` occur during normal GUI use (verified by observing file mtimes).
- The spec's error paths (missing DB, missing report, busy DB, giant report, watcher failure) all behave as documented.

## Out-of-scope reminders

The following are explicitly **not** in this plan and must be proposed as separate work before being implemented:

- Search / filter / date ranges on the task list
- `events.jsonl` timeline replay
- Re-running / cancelling / deleting tasks from the GUI
- Code signing / notarization
- Multiple simultaneous windows or detachable reports
