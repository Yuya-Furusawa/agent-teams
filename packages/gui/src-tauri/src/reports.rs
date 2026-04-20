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

    pub fn planner_events(&self, task_id: &str) -> Result<Option<String>> {
        read_capped(&self.root.join(task_id).join("planner-events.jsonl"))
    }

    pub fn artifacts(&self, task_id: &str) -> crate::models::TaskArtifacts {
        let base = self.root.join(task_id);
        crate::models::TaskArtifacts {
            summary_exists: base.join("summary.md").exists(),
            planner_events_exists: base.join("planner-events.jsonl").exists(),
            triage_events_exists: base.join("triage-events.jsonl").exists(),
        }
    }
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
