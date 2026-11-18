//! Commit history across all branches, for the branch graph view.
use crate::git::git;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RefLabel {
    pub name: String,
    /// "local", "remote", "tag" or "head" (detached HEAD).
    pub kind: &'static str,
    /// The checked-out branch.
    pub current: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub refs: Vec<RefLabel>,
    pub author: String,
    pub timestamp: i64,
    pub subject: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub remote: bool,
    pub hash: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Upstream branch was deleted.
    pub gone: bool,
    pub current: bool,
    pub timestamp: i64,
    pub subject: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    /// Newest first, in topological order (children before parents).
    pub commits: Vec<GraphCommit>,
    pub branches: Vec<Branch>,
    pub head: Option<String>,
    /// More commits exist than `limit`.
    pub truncated: bool,
}

pub fn graph(dir: &Path, limit: usize) -> Result<Graph, String> {
    let n = (limit + 1).to_string();
    // A repo with no commits yet has nothing to show; that's not an error.
    let has_commits = git(dir, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok()
        || !git(dir, &["for-each-ref", "--count=1", "refs/heads", "refs/remotes"])?.trim().is_empty();
    let log = if has_commits {
        git(
            dir,
            &[
                "log",
                "--exclude=refs/stash",
                "--all",
                "--topo-order",
                "--decorate=full",
                "-n",
                &n,
                "--format=%H%x1f%P%x1f%D%x1f%an%x1f%ct%x1f%s",
            ],
        )?
    } else {
        String::new()
    };
    let mut commits: Vec<GraphCommit> = log.lines().filter_map(parse_log_line).collect();
    let truncated = commits.len() > limit;
    commits.truncate(limit);

    let head = git(dir, &["rev-parse", "--verify", "-q", "HEAD"]).ok().map(|s| s.trim().to_string());

    let refs = git(
        dir,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(HEAD)%1f%(refname)%1f%(objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(committerdate:unix)%1f%(contents:subject)",
            "refs/heads",
            "refs/remotes",
        ],
    )
    .unwrap_or_default();
    let mut branches: Vec<Branch> = refs.lines().filter_map(parse_branch_line).collect();
    // Current branch, then other local branches, then remotes; newest first within each (sort is stable).
    branches.sort_by_key(|b| (b.remote, !b.current));

    Ok(Graph { commits, branches, head, truncated })
}

fn parse_log_line(line: &str) -> Option<GraphCommit> {
    let mut f = line.splitn(6, '\x1f');
    let hash = f.next()?.trim().to_string();
    if hash.is_empty() {
        return None;
    }
    let parents = f.next()?.split_whitespace().map(str::to_string).collect();
    let refs = parse_decorations(f.next()?);
    let author = f.next()?.to_string();
    let timestamp = f.next()?.trim().parse().unwrap_or(0);
    let subject = f.next().unwrap_or("").trim_end_matches('\r').to_string();
    Some(GraphCommit { hash, parents, refs, author, timestamp, subject })
}

/// Parses `%D` output with `--decorate=full`, e.g.
/// `HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0`.
fn parse_decorations(d: &str) -> Vec<RefLabel> {
    let mut out = Vec::new();
    for part in d.split(", ").map(str::trim).filter(|s| !s.is_empty()) {
        let (current, name) = match part.strip_prefix("HEAD -> ") {
            Some(n) => (true, n),
            None => (false, part),
        };
        let label = if name == "HEAD" {
            RefLabel { name: "HEAD".into(), kind: "head", current: false }
        } else if let Some(t) = name.strip_prefix("tag: ") {
            RefLabel { name: t.trim_start_matches("refs/tags/").into(), kind: "tag", current: false }
        } else if let Some(b) = name.strip_prefix("refs/heads/") {
            RefLabel { name: b.into(), kind: "local", current }
        } else if let Some(r) = name.strip_prefix("refs/remotes/") {
            if r.ends_with("/HEAD") {
                continue; // origin/HEAD is just a pointer to the default branch
            }
            RefLabel { name: r.into(), kind: "remote", current: false }
        } else {
            continue; // notes, replace refs, etc.
        };
        out.push(label);
    }
    out
}

pub(crate) fn parse_branch_line(line: &str) -> Option<Branch> {
    let f: Vec<&str> = line.splitn(7, '\x1f').collect();
    let [head, refname, hash, upstream, track, ts, subject] = f.as_slice() else { return None };
    let (name, remote) = if let Some(n) = refname.strip_prefix("refs/heads/") {
        (n, false)
    } else if let Some(n) = refname.strip_prefix("refs/remotes/") {
        if n.ends_with("/HEAD") {
            return None;
        }
        (n, true)
    } else {
        return None;
    };
    let (mut ahead, mut behind, mut gone) = (0, 0, false);
    for part in track.split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.trim().parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.trim().parse().unwrap_or(0);
        } else if part.trim() == "gone" {
            gone = true;
        }
    }
    Some(Branch {
        name: name.to_string(),
        remote,
        hash: hash.to_string(),
        upstream: (!upstream.is_empty()).then(|| upstream.to_string()),
        ahead,
        behind,
        gone,
        current: head.trim() == "*",
        timestamp: ts.trim().parse().unwrap_or(0),
        subject: subject.trim_end_matches('\r').to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn label(name: &str, kind: &'static str, current: bool) -> RefLabel {
        RefLabel { name: name.into(), kind, current }
    }

    #[test]
    fn parses_decorations() {
        let d = "HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1.0, refs/heads/feature/x";
        assert_eq!(
            parse_decorations(d),
            vec![
                label("main", "local", true),
                label("origin/main", "remote", false),
                label("v1.0", "tag", false),
                label("feature/x", "local", false),
            ]
        );
        assert_eq!(parse_decorations("HEAD, refs/heads/dev"), vec![label("HEAD", "head", false), label("dev", "local", false)]);
        assert!(parse_decorations("").is_empty());
    }

    #[test]
    fn parses_log_line() {
        let c = parse_log_line("aaa\x1fbbb ccc\x1fHEAD -> refs/heads/main\x1fAda\x1f1700000000\x1fMerge branch 'x'").unwrap();
        assert_eq!(c.parents, vec!["bbb", "ccc"]);
        assert_eq!(c.refs, vec![label("main", "local", true)]);
        assert_eq!(c.subject, "Merge branch 'x'");
        let root = parse_log_line("aaa\x1f\x1f\x1fAda\x1f1\x1froot").unwrap();
        assert!(root.parents.is_empty() && root.refs.is_empty());
    }

    /// Builds a small real repo (needs git on PATH) and reads it back.
    #[test]
    fn reads_real_repo() {
        let dir = std::env::temp_dir().join(format!("devhub-graph-{}", std::process::id()));
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
        assert!(graph(&dir, 10).unwrap().commits.is_empty(), "empty repo is not an error");
        run(&["commit", "-q", "--allow-empty", "-m", "one"]);
        run(&["checkout", "-q", "-b", "feature"]);
        run(&["commit", "-q", "--allow-empty", "-m", "two"]);
        run(&["checkout", "-q", "main"]);
        run(&["commit", "-q", "--allow-empty", "-m", "three"]);
        run(&["merge", "-q", "--no-ff", "feature", "-m", "merge"]);
        run(&["tag", "v1"]);

        let g = graph(&dir, 10).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(g.commits.len(), 4);
        assert!(!g.truncated);
        let top = &g.commits[0];
        assert_eq!(top.subject, "merge");
        assert_eq!(top.parents.len(), 2);
        assert_eq!(g.head.as_deref(), Some(top.hash.as_str()));
        assert!(top.refs.contains(&label("main", "local", true)));
        assert!(top.refs.contains(&label("v1", "tag", false)));
        assert_eq!(g.commits.last().unwrap().subject, "one");
        let names: Vec<_> = g.branches.iter().map(|b| (b.name.as_str(), b.current)).collect();
        assert_eq!(names, vec![("main", true), ("feature", false)]);

        let missing = graph(&dir.parent().unwrap().join("does-not-exist"), 10);
        assert!(missing.is_err());
    }

    #[test]
    fn parses_branch_lines() {
        let b = parse_branch_line("*\x1frefs/heads/main\x1fabc\x1forigin/main\x1fahead 2, behind 1\x1f1700\x1fsubj").unwrap();
        assert!(b.current && !b.remote && !b.gone);
        assert_eq!((b.ahead, b.behind, b.upstream.as_deref()), (2, 1, Some("origin/main")));
        let g = parse_branch_line(" \x1frefs/heads/old\x1fabc\x1forigin/old\x1fgone\x1f1\x1fs").unwrap();
        assert!(g.gone && !g.current);
        let r = parse_branch_line(" \x1frefs/remotes/origin/dev\x1fabc\x1f\x1f\x1f1\x1fs").unwrap();
        assert!(r.remote && r.upstream.is_none());
        assert!(parse_branch_line(" \x1frefs/remotes/origin/HEAD\x1fabc\x1f\x1f\x1f1\x1fs").is_none());
    }
}
