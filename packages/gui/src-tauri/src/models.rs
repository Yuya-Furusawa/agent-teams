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
