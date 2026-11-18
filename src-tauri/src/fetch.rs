//! `git fetch` for many repos at once.
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
}

pub fn fetch_one(dir: &Path) -> Result<(), String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(dir)
        .args(["fetch", "--all", "--prune", "--quiet"])
        // Never prompt for credentials: fail instead of hanging.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never");
    crate::proc::run(cmd, Duration::from_secs(90)).map(drop)
}

pub fn fetch_all(dirs: &[PathBuf], progress: &(dyn Fn(usize, usize) + Sync)) -> Vec<FetchResult> {
    crate::proc::parallel(
        dirs,
        6,
        |dir| {
            let r = fetch_one(dir);
            FetchResult { path: dir.display().to_string(), ok: r.is_ok(), error: r.err() }
        },
        progress,
    )
}
