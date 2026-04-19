use anyhow::Result;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub name: String,
    pub role: Option<String>,
}

pub fn resolve_agents_dir() -> Option<PathBuf> {
    if let Ok(v) = std::env::var("AGENT_TEAMS_AGENTS_DIR") {
        let p = PathBuf::from(v);
        if p.is_dir() {
            return Some(p);
        }
    }
    // Compile-time fallback: packages/gui/src-tauri → ../../../agents
    let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("agents");
    if fallback.is_dir() {
        return Some(fallback);
    }
    None
}

pub fn list_agents() -> Result<Vec<AgentInfo>> {
    let Some(dir) = resolve_agents_dir() else {
        return Ok(Vec::new());
    };
    read_agents_from(&dir)
}

fn read_agents_from(dir: &Path) -> Result<Vec<AgentInfo>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let raw = match fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let role = extract_role(&raw);
        out.push(AgentInfo {
            name: stem.to_string(),
            role,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Parse the YAML frontmatter and return the `role` field if present.
///
/// Frontmatter is between leading `---` lines. We only need a single scalar
/// field, so we do line-level parsing and skip adding a YAML dependency.
fn extract_role(raw: &str) -> Option<String> {
    let mut lines = raw.lines();
    let first = lines.next()?;
    if first.trim() != "---" {
        return None;
    }
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        // Indented lines belong to a previous multi-line scalar — skip.
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("role:") {
            let v = rest.trim().trim_matches(|c| c == '"' || c == '\'');
            if v.is_empty() {
                return None;
            }
            return Some(v.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn extracts_role_from_simple_frontmatter() {
        let md = "---\nname: Kai\nrole: implementer\n---\n\nbody";
        assert_eq!(extract_role(md).as_deref(), Some("implementer"));
    }

    #[test]
    fn returns_none_when_role_absent() {
        let md = "---\nname: X\n---\nbody";
        assert_eq!(extract_role(md), None);
    }

    #[test]
    fn ignores_role_inside_multiline_scalar() {
        let md = "---\nname: X\npersonality: >\n  role: not-this\nrole: real\n---\n";
        assert_eq!(extract_role(md).as_deref(), Some("real"));
    }

    #[test]
    fn list_agents_reads_directory_sorted() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("Kai.md"),
            "---\nname: Kai\nrole: implementer\n---\nbody",
        )
        .unwrap();
        fs::write(
            dir.path().join("Iris.md"),
            "---\nname: Iris\nrole: code-reviewer\n---\nbody",
        )
        .unwrap();
        fs::write(dir.path().join("not-agent.txt"), "ignore me").unwrap();
        let got = read_agents_from(dir.path()).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "Iris");
        assert_eq!(got[0].role.as_deref(), Some("code-reviewer"));
        assert_eq!(got[1].name, "Kai");
    }
}
