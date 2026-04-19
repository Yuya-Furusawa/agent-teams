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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
