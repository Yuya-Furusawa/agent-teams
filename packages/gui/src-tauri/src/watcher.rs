use notify::{RecursiveMode, Watcher};
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
