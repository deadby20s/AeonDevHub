//! Uncommitted files and their diffs.
use crate::git::git;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// Path relative to the repo root, forward slashes.
    pub path: String,
    /// Previous path for renames and copies.
    pub orig: Option<String>,
    /// Status letters from `git status --porcelain`: X = index (staged), Y = worktree.
    pub x: String,
    pub y: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub text: String,
    pub binary: bool,
    pub truncated: bool,
}

const MAX_FILES: usize = 3000;
const MAX_DIFF: usize = 400 * 1024;

pub fn changes(dir: &Path) -> Result<Vec<FileChange>, String> {
    let out = git(dir, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    Ok(parse_porcelain_z(&out))
}

fn parse_porcelain_z(out: &str) -> Vec<FileChange> {
    let mut v = Vec::new();
    let mut parts = out.split('\0');
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            continue;
        }
        let (x, y) = (&entry[0..1], &entry[1..2]);
        let path = entry[3..].to_string();
        // Renames/copies are followed by the original path as its own entry.
        let orig = if x == "R" || x == "C" { parts.next().map(str::to_string) } else { None };
        v.push(FileChange { path, orig, x: x.to_string(), y: y.to_string() });
        if v.len() >= MAX_FILES {
            break;
        }
    }
    v
}

/// Diff of one changed file. `staged` picks the index side (`git diff --cached`).
/// The file must currently show up in `git status`, so this can't read arbitrary paths.
pub fn diff(dir: &Path, file: &str, staged: bool) -> Result<Diff, String> {
    let all = changes(dir)?;
    let change = all.iter().find(|c| c.path == file).ok_or("That file has no changes any more.")?;

    if change.x == "?" {
        // Untracked: show the whole file as added.
        let bytes = std::fs::read(dir.join(file)).map_err(|e| e.to_string())?;
        if bytes[..bytes.len().min(8000)].contains(&0) {
            return Ok(Diff { text: String::new(), binary: true, truncated: false });
        }
        let truncated = bytes.len() > MAX_DIFF;
        let text = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_DIFF)]);
        let lines: Vec<&str> = text.lines().collect();
        let mut out = format!("new file\n@@ -0,0 +1,{} @@\n", lines.len());
        for l in lines {
            out.push('+');
            out.push_str(l);
            out.push('\n');
        }
        return Ok(Diff { text: out, binary: false, truncated });
    }

    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--find-renames"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    if let Some(o) = change.orig.as_deref() {
        args.push(o);
    }
    args.push(file);
    let mut text = git(dir, &args)?;
    let binary = text.lines().any(|l| l.starts_with("Binary files ") && l.ends_with(" differ"));
    let truncated = text.len() > MAX_DIFF;
    if truncated {
        let mut cut = MAX_DIFF;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
    }
    Ok(Diff { text, binary, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_z() {
        let out = " M src/a.rs\0MM b.rs\0R  new.rs\0old.rs\0?? notes.txt\0UU x.rs\0";
        let v = parse_porcelain_z(out);
        assert_eq!(v.len(), 5);
        assert_eq!((v[0].x.as_str(), v[0].y.as_str(), v[0].path.as_str()), (" ", "M", "src/a.rs"));
        assert_eq!(v[2].orig.as_deref(), Some("old.rs"));
        assert_eq!(v[2].path, "new.rs");
        assert_eq!((v[3].x.as_str(), v[3].path.as_str()), ("?", "notes.txt"));
        assert_eq!(v[4].x, "U");
    }
}
