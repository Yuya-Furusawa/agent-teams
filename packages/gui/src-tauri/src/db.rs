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
              COALESCE(SUM(CASE WHEN s.status = 'failed'    THEN 1 ELSE 0 END), 0)     AS failed_count,
              t.workspace_name
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
                    workspace: r.get(9)?,
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
                  COALESCE(SUM(CASE WHEN s.status = 'failed'    THEN 1 ELSE 0 END), 0),
                  t.workspace_name
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
                        workspace: r.get(9)?,
                    })
                },
            )
            .ok();
        let Some(task) = task else { return Ok(None); };
        let mut stmt = conn.prepare(
            r#"
            SELECT id, task_id, title, assigned_agent, status, created_at, completed_at, target_repo, depends_on
            FROM sub_tasks
            WHERE task_id = ?1
            ORDER BY created_at ASC
            "#,
        )?;
        let sub_tasks = stmt
            .query_map([task_id], |r| {
                let deps_raw: Option<String> = r.get(8)?;
                let depends_on: Vec<String> = deps_raw
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
                    .unwrap_or_default();
                Ok(SubTask {
                    id: r.get(0)?,
                    task_id: r.get(1)?,
                    title: r.get(2)?,
                    assigned_agent: r.get(3)?,
                    status: r.get(4)?,
                    created_at: r.get(5)?,
                    completed_at: r.get(6)?,
                    target_repo: r.get(7)?,
                    depends_on,
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
              team_name TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER,
              workspace_name TEXT, repos TEXT);
            CREATE TABLE sub_tasks (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL,
              prompt TEXT NOT NULL, assigned_agent TEXT NOT NULL, status TEXT NOT NULL,
              created_at INTEGER NOT NULL, completed_at INTEGER, target_repo TEXT, depends_on TEXT);
            INSERT INTO tasks VALUES ('t1', 'desc one', '/w', 'default', 'completed', 1000, 2000, NULL, NULL);
            INSERT INTO tasks VALUES ('t2', 'desc two', '/w', 'default', 'running',   3000, NULL, 'my-app', '[]');
            INSERT INTO sub_tasks VALUES ('s1a', 't1', 'one', '', 'Lin', 'completed', 1000, 1500, NULL, NULL);
            INSERT INTO sub_tasks VALUES ('s1b', 't1', 'two', '', 'Kai', 'failed',    1100, 1600, NULL, '["s1a"]');
            INSERT INTO sub_tasks VALUES ('s2a', 't2', 'a',   '', 'Kai', 'running',   3100, NULL, 'backend', NULL);
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
