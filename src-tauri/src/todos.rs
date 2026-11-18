use ignore::WalkBuilder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    /// Path relative to the project root, with forward slashes.
    pub file: String,
    pub line: u32,
    pub kind: String,
    pub text: String,
}

/// Uppercase marker as a whole word, followed by an optional `(owner)`, then `:`, `!`,
/// whitespace or end of line. That skips `MY_TODO`, quoted markers and `TODO|FIXME` in regexes.
static MARKER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(TODO|FIXME|HACK|XXX)\b(?:\([^)]*\))?(?:[:!]|\s|$)\s*(.*)").unwrap()
});

/// Build output and dependency folders, skipped even in projects without a .gitignore.
const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", ".venv", "venv", "__pycache__", "vendor", ".next",
    ".nuxt", ".svelte-kit", ".turbo", "coverage", ".gradle", "Pods", "DerivedData",
];

const SKIP_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "icns", "bmp", "tiff", "psd", "svg", "pdf",
    "zip", "gz", "tgz", "tar", "7z", "rar", "xz", "exe", "dll", "so", "dylib", "a", "lib",
    "o", "obj", "pdb", "wasm", "class", "jar", "bin", "dat", "db", "sqlite", "parquet",
    "arrow", "woff", "woff2", "ttf", "otf", "eot", "mp3", "mp4", "wav", "ogg", "mov", "webm",
    "lock", "map", "snap", "ipynb",
];

const SKIP_FILES: &[&str] = &[
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "go.sum", "changelog.md",
];

const MAX_FILE: u64 = 512 * 1024;

/// Returns up to `cap` TODOs plus the total number found.
pub fn scan(root: &Path, cap: usize) -> (Vec<Todo>, usize) {
    let mut todos = Vec::new();
    let mut count = 0usize;

    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .require_git(false)
        .max_filesize(Some(MAX_FILE))
        .filter_entry(|e| {
            let is_dir = e.file_type().is_some_and(|t| t.is_dir());
            !(is_dir && e.depth() > 0 && SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
        })
        .build();

    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if SKIP_FILES.contains(&name.as_str()) || name.ends_with(".min.js") || name.ends_with(".min.css") {
            continue;
        }
        if let Some(ext) = path.extension() {
            if SKIP_EXT.contains(&ext.to_string_lossy().to_ascii_lowercase().as_str()) {
                continue;
            }
        }
        let Ok(bytes) = fs::read(path) else { continue };
        if bytes[..bytes.len().min(8000)].contains(&0) {
            continue; // binary
        }
        let text = String::from_utf8_lossy(&bytes);
        if !MARKER.is_match(&text) {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        for (i, line) in text.lines().enumerate() {
            if line.len() > 1000 {
                continue; // minified / generated
            }
            if let Some(c) = MARKER.captures(line) {
                count += 1;
                if todos.len() < cap {
                    todos.push(Todo {
                        file: rel.clone(),
                        line: i as u32 + 1,
                        kind: c[1].to_string(),
                        text: clean(&c[2]),
                    });
                }
            }
        }
    }
    todos.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    (todos, count)
}

/// Strip comment terminators and trim to a readable length.
fn clean(s: &str) -> String {
    let mut s = s.trim();
    for end in ["*/", "-->", "#}", "%}", "}}"] {
        s = s.trim_end_matches(end).trim_end();
    }
    let s = s.trim_start_matches(['-', ':']).trim();
    if s.chars().count() > 200 {
        let cut: String = s.chars().take(199).collect();
        format!("{cut}…")
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(line: &str) -> Option<(String, String)> {
        MARKER.captures(line).map(|c| (c[1].to_string(), clean(&c[2])))
    }

    #[test]
    fn matches_markers() {
        assert_eq!(hit("// TODO: wire up cache"), Some(("TODO".into(), "wire up cache".into())));
        assert_eq!(hit("# FIXME(ada) off by one"), Some(("FIXME".into(), "off by one".into())));
        assert_eq!(hit("/* HACK: temp */"), Some(("HACK".into(), "temp".into())));
        assert_eq!(hit("<!-- TODO -->"), Some(("TODO".into(), "".into())));
        assert_eq!(hit("let x = 1; // XXX"), Some(("XXX".into(), "".into())));
    }

    #[test]
    fn ignores_non_markers() {
        assert!(hit("const MY_TODO = 1;").is_none());
        assert!(hit("todo: lowercase").is_none());
        assert!(hit(r#"Regex::new("TODO|FIXME")"#).is_none());
        assert!(hit("let s = \"TODO\";").is_none());
        assert!(hit("ssn: XXX-XX-XXXX").is_none());
        assert!(hit("TODOS list").is_none());
    }
}
