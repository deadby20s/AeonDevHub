use crate::config::Config;
use crate::git::{self, GitInfo};
use crate::todos::{self, Todo};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::UNIX_EPOCH;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    pub path: String,
    pub kinds: Vec<String>,
    /// Present when the folder is a git repo.
    pub git: Option<GitInfo>,
    pub todos: Vec<Todo>,
    pub todo_count: usize,
    /// Folder mtime (unix seconds); used for sorting projects without commits.
    pub modified: Option<i64>,
}

const TODO_CAP: usize = 300;

const FILE_MARKERS: &[(&str, &str)] = &[
    ("Cargo.toml", "rust"),
    ("package.json", "node"),
    ("deno.json", "deno"),
    ("pyproject.toml", "python"),
    ("requirements.txt", "python"),
    ("setup.py", "python"),
    ("go.mod", "go"),
    ("pom.xml", "java"),
    ("build.gradle", "java"),
    ("build.gradle.kts", "kotlin"),
    ("composer.json", "php"),
    ("Gemfile", "ruby"),
    ("pubspec.yaml", "dart"),
    ("CMakeLists.txt", "c++"),
    ("mix.exs", "elixir"),
    ("Package.swift", "swift"),
    ("build.zig", "zig"),
];
const DIR_MARKERS: &[(&str, &str)] = &[("src-tauri", "tauri")];

/// Folders never descended into while looking for projects.
const DISCOVERY_SKIP: &[&str] = &[
    "node_modules", "target", "dist", "build", "out", "venv", "env", "__pycache__", "vendor",
    "bin", "obj", "coverage", "AppData", "Library",
];

/// Returns (is a git repo, detected project kinds).
fn detect(dir: &Path) -> (bool, Vec<String>) {
    let mut is_git = false;
    let mut kinds: Vec<String> = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else { return (false, kinds) };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            is_git = true; // dir, or file for worktrees/submodules
            continue;
        }
        let is_dir = e.file_type().is_ok_and(|t| t.is_dir());
        let lower = name.to_ascii_lowercase();
        let kind = if is_dir {
            DIR_MARKERS.iter().find(|(m, _)| *m == lower).map(|(_, k)| *k)
        } else {
            FILE_MARKERS
                .iter()
                .find(|(m, _)| m.eq_ignore_ascii_case(&name))
                .map(|(_, k)| *k)
                .or_else(|| (lower.ends_with(".sln") || lower.ends_with(".csproj")).then_some("dotnet"))
        };
        if let Some(k) = kind {
            if !kinds.iter().any(|x| x == k) {
                kinds.push(k.to_string());
            }
        }
    }
    kinds.sort();
    (is_git, kinds)
}

/// Finds project folders under each root. A folder that is a git repo or has a
/// project marker is a project, and its subfolders are not searched further.
pub fn discover(roots: &[String], max_depth: u32) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        let p = PathBuf::from(root.trim());
        if !p.as_os_str().is_empty() && p.is_dir() {
            walk(&p, 0, max_depth, &mut out, &mut seen);
        }
    }
    out
}

fn walk(dir: &Path, depth: u32, max: u32, out: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>) {
    let (is_git, kinds) = detect(dir);
    if is_git || !kinds.is_empty() {
        let key = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
        if seen.insert(key) {
            out.push(dir.to_path_buf());
        }
        return;
    }
    if depth >= max {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut subs: Vec<PathBuf> = rd
        .flatten()
        // file_type() doesn't follow links, so symlinks/junctions are skipped (no loops).
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            !n.starts_with('.') && !n.starts_with('$') && !DISCOVERY_SKIP.contains(&n.as_str())
        })
        .map(|e| e.path())
        .collect();
    subs.sort();
    for s in subs {
        walk(&s, depth + 1, max, out, seen);
    }
}

pub fn scan_project(dir: &Path, with_todos: bool) -> Project {
    let (is_git, kinds) = detect(dir);
    let git = is_git.then(|| git::info(dir));
    let (todos, todo_count) = if with_todos { todos::scan(dir, TODO_CAP) } else { (Vec::new(), 0) };
    let modified = fs::metadata(dir)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    Project {
        name: dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| dir.display().to_string()),
        path: dir.display().to_string(),
        kinds,
        git,
        todos,
        todo_count,
        modified,
    }
}

/// Scans every non-hidden project in parallel. `progress(done, total)` is called as projects finish.
pub fn scan_all(cfg: &Config, progress: &(dyn Fn(usize, usize) + Sync)) -> Vec<Project> {
    let hidden: HashSet<&str> = cfg.hidden.iter().map(String::as_str).collect();
    let paths: Vec<PathBuf> = discover(&cfg.roots, cfg.scan_depth)
        .into_iter()
        .filter(|p| !hidden.contains(p.display().to_string().as_str()))
        .collect();
    let total = paths.len();
    progress(0, total);

    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let results = Mutex::new(Vec::with_capacity(total));
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).clamp(2, 8);
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= total {
                    break;
                }
                let p = scan_project(&paths[i], cfg.scan_todos);
                results.lock().unwrap().push(p);
                progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);
            });
        }
    });
    let mut v = results.into_inner().unwrap();
    v.sort_by_key(|p| p.name.to_lowercase());
    v
}

#[cfg(test)]
mod tests {
    /// Smoke test against the default roots on this machine:
    /// `cargo test -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn scan_default_roots() {
        let cfg = crate::config::Config::default();
        let t = std::time::Instant::now();
        let projects = super::scan_all(&cfg, &|_, _| {});
        for p in &projects {
            let g = p.git.as_ref();
            println!(
                "{:<24} {:<14} kinds={:?} branch={:?} changes={} todos={} last={:?} err={:?}",
                p.name,
                p.path.len(),
                p.kinds,
                g.and_then(|g| g.branch.clone()),
                g.map_or(0, |g| g.staged + g.modified + g.untracked),
                p.todo_count,
                g.and_then(|g| g.last_commit.as_ref().map(|c| c.subject.clone())),
                g.and_then(|g| g.error.clone()),
            );
        }
        println!("{} projects in {:?} (roots {:?})", projects.len(), t.elapsed(), cfg.roots);
    }
}

pub fn load_cache(path: &Path) -> Vec<Project> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_cache(path: &Path, projects: &[Project]) {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(projects) {
        let _ = fs::write(path, json);
    }
}
