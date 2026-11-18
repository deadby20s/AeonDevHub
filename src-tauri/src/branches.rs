//! Finding and deleting local branches that are merged or whose upstream is gone.
use crate::git::git;
use crate::graph::parse_branch_line;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StaleBranch {
    pub name: String,
    /// Fully merged into the base branch: safe to delete.
    pub merged: bool,
    /// Its upstream branch was deleted on the remote.
    pub gone: bool,
    pub upstream: Option<String>,
    pub timestamp: i64,
    pub subject: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Stale {
    /// Branch the others are compared against (e.g. `main` or `origin/main`).
    pub base: String,
    pub branches: Vec<StaleBranch>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub name: String,
    pub ok: bool,
    pub error: Option<String>,
}

fn local_exists(dir: &Path, name: &str) -> bool {
    git(dir, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{name}")]).is_ok()
}

/// The repo's default branch: what origin/HEAD points to, else main/master/…, else the current branch.
fn base_branch(dir: &Path, current: Option<&str>) -> Option<String> {
    if let Ok(s) = git(dir, &["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]) {
        let remote = s.trim();
        if let Some(short) = remote.strip_prefix("origin/") {
            return Some(if local_exists(dir, short) { short.to_string() } else { remote.to_string() });
        }
    }
    ["main", "master", "trunk", "develop"]
        .iter()
        .find(|b| local_exists(dir, b))
        .map(|b| b.to_string())
        .or_else(|| current.map(str::to_string))
}

pub fn stale(dir: &Path) -> Result<Stale, String> {
    let refs = git(
        dir,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(HEAD)%1f%(refname)%1f%(objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(committerdate:unix)%1f%(contents:subject)",
            "refs/heads",
        ],
    )?;
    let locals: Vec<_> = refs.lines().filter_map(parse_branch_line).collect();
    let current = locals.iter().find(|b| b.current).map(|b| b.name.clone());
    let Some(base) = base_branch(dir, current.as_deref()) else {
        return Ok(Stale { base: String::new(), branches: Vec::new() });
    };
    let merged: HashSet<String> = git(dir, &["branch", "--format=%(refname:short)", "--merged", &base])
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim().to_string())
        .collect();
    let branches = locals
        .into_iter()
        .filter(|b| !b.current && b.name != base)
        .filter_map(|b| {
            let is_merged = merged.contains(&b.name);
            (is_merged || b.gone).then(|| StaleBranch {
                merged: is_merged,
                gone: b.gone,
                upstream: b.upstream,
                timestamp: b.timestamp,
                subject: b.subject,
                name: b.name,
            })
        })
        .collect();
    Ok(Stale { base, branches })
}

/// Deletes the given branches, but only ones `stale()` still reports, so this can never
/// remove the current, base or an unrelated branch. Unmerged branches need `force`.
pub fn delete(dir: &Path, names: &[String], force: bool) -> Result<Vec<DeleteResult>, String> {
    let s = stale(dir)?;
    Ok(names
        .iter()
        .map(|name| {
            let result = match s.branches.iter().find(|b| &b.name == name) {
                None => Err("not a stale branch any more".to_string()),
                Some(b) if !b.merged && !force => Err(format!("not merged into {}", s.base)),
                Some(b) => {
                    let flag = if b.merged { "-d" } else { "-D" };
                    git(dir, &["branch", flag, "--", &b.name]).map(drop)
                }
            };
            DeleteResult { name: name.clone(), ok: result.is_ok(), error: result.err() }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_and_deletes_merged_branches() {
        let dir = std::env::temp_dir().join(format!("devhub-stale-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |args: &[&str]| {
            let out = std::process::Command::new("git")
                .arg("-C").arg(&dir)
                .args(["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"])
                .args(args)
                .output()
                .unwrap();
            assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        };
        run(&["init", "-q", "-b", "main"]);
        run(&["commit", "-q", "--allow-empty", "-m", "one"]);
        run(&["branch", "done"]); // merged (same commit as main)
        run(&["checkout", "-q", "-b", "wip"]);
        run(&["commit", "-q", "--allow-empty", "-m", "unmerged work"]);
        run(&["checkout", "-q", "main"]);

        let s = stale(&dir).unwrap();
        assert_eq!(s.base, "main");
        let names: Vec<_> = s.branches.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names, vec!["done"], "wip is unmerged with no upstream, main is the base");

        let r = delete(&dir, &["done".into(), "wip".into(), "main".into()], true).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(r[0].ok);
        assert!(!r[1].ok && !r[2].ok, "only listed stale branches can be deleted");
    }
}
