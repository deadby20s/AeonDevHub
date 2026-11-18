//! Your commit timestamps across all projects, for the activity view.
use crate::git::git;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActivity {
    pub path: String,
    /// Unix seconds of each of your commits (any branch, merges excluded).
    pub commits: Vec<i64>,
    /// The author email that was matched; empty means all authors.
    pub email: String,
}

pub fn project(dir: &Path, since: i64) -> ProjectActivity {
    // user.email resolves repo config first, then global.
    let email = git(dir, &["config", "user.email"]).map(|s| s.trim().to_string()).unwrap_or_default();
    let since_arg = format!("--since={since}");
    let mut args = vec!["log", "--all", "--no-merges", &since_arg, "--format=%ct"];
    let author;
    if !email.is_empty() {
        author = format!("--author=<{email}>");
        args.push(&author);
    }
    let commits = git(dir, &args)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect();
    ProjectActivity { path: dir.display().to_string(), commits, email }
}

pub fn all(dirs: &[PathBuf], since: i64) -> Vec<ProjectActivity> {
    crate::proc::parallel(dirs, 8, |d| project(d, since), &|_, _| {})
}
