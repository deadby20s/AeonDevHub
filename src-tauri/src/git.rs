use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: u32,
    pub modified: u32,
    pub untracked: u32,
    pub conflicts: u32,
    pub last_commit: Option<Commit>,
    pub remote_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    /// Unix seconds.
    pub timestamp: i64,
}

pub(crate) fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(dir)
        .args(args)
        // Read-only: don't take index.lock or refresh the index on disk.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0");
    crate::launch::no_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("git is not available: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

pub fn info(dir: &Path) -> GitInfo {
    let mut g = GitInfo::default();
    match git(dir, &["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]) {
        Ok(s) => parse_status(&s, &mut g),
        Err(e) => {
            g.error = Some(if e.is_empty() { "git status failed".into() } else { e });
            return g;
        }
    }
    // Fails on a repo with no commits yet; that's fine.
    if let Ok(s) = git(dir, &["log", "-1", "--format=%h%x1f%s%x1f%an%x1f%ct"]) {
        g.last_commit = parse_commit(&s);
    }
    if let Ok(s) = git(dir, &["config", "--get", "remote.origin.url"]) {
        let s = s.trim();
        if !s.is_empty() {
            g.remote_url = Some(s.to_string());
        }
    }
    g
}

fn parse_commit(s: &str) -> Option<Commit> {
    let parts: Vec<&str> = s.trim_end_matches(['\r', '\n']).split('\x1f').collect();
    let [hash, subject, author, ts] = parts.as_slice() else { return None };
    Some(Commit {
        hash: hash.to_string(),
        subject: subject.to_string(),
        author: author.to_string(),
        timestamp: ts.trim().parse().unwrap_or(0),
    })
}

fn parse_status(s: &str, g: &mut GitInfo) {
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            g.branch = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            g.upstream = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for part in rest.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    g.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    g.behind = n.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            // "1 XY ..." where X = index (staged) state, Y = worktree state; '.' = unchanged.
            let b = line.as_bytes();
            if b.get(2).is_some_and(|&c| c != b'.') {
                g.staged += 1;
            }
            if b.get(3).is_some_and(|&c| c != b'.') {
                g.modified += 1;
            }
        } else if line.starts_with("u ") {
            g.conflicts += 1;
        } else if line.starts_with("? ") {
            g.untracked += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let out = "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n\
1 M. N... 100644 100644 100644 a b src/a.rs\n1 .M N... 100644 100644 100644 a b src/b.rs\n\
1 MM N... 100644 100644 100644 a b src/c.rs\n2 R. N... 100644 100644 100644 a b R100 new.rs\told.rs\n\
u UU N... 1 2 3 4 a b c x.rs\n? notes.txt\n? tmp/\n";
        let mut g = GitInfo::default();
        parse_status(out, &mut g);
        assert_eq!(g.branch.as_deref(), Some("main"));
        assert_eq!(g.upstream.as_deref(), Some("origin/main"));
        assert_eq!((g.ahead, g.behind), (2, 1));
        assert_eq!((g.staged, g.modified, g.untracked, g.conflicts), (3, 2, 2, 1));
    }

    #[test]
    fn parses_commit_line() {
        let c = parse_commit("1a2b3c\x1fFix: thing | other\x1fAda\x1f1700000000\n").unwrap();
        assert_eq!(c.subject, "Fix: thing | other");
        assert_eq!(c.timestamp, 1_700_000_000);
        assert!(parse_commit("").is_none());
    }
}
