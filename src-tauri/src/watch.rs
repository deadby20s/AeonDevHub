//! Watches project folders and rescans a project shortly after its files or git state change.
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Wait this long after the last change before rescanning (saves, builds and checkouts come in bursts).
const QUIET: Duration = Duration::from_millis(1500);

/// Dropping this stops the watcher and its worker thread.
pub struct ProjectWatcher {
    _watcher: RecommendedWatcher,
}

/// Folders whose changes never affect git status or TODOs we care about.
const NOISE_DIRS: &[&str] = &[
    "node_modules", "target", "dist", ".next", ".nuxt", ".svelte-kit", ".turbo", "__pycache__",
    ".venv", "venv", ".gradle", ".idea", ".vs", "coverage", ".cache", "obj",
];

/// Whether a changed path (inside project `root`) should trigger a rescan.
fn relevant(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else { return false };
    let parts: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    match parts.first().map(String::as_str) {
        None => false,
        // Inside .git only refs, HEAD and the index matter (commits, checkouts, staging, fetches).
        Some(".git") => {
            let name = parts.last().map(String::as_str).unwrap_or("");
            parts.get(1).is_some_and(|p| p == "refs")
                || ["HEAD", "index", "packed-refs", "ORIG_HEAD", "MERGE_HEAD", "FETCH_HEAD"].contains(&name)
        }
        Some(_) => !parts.iter().any(|p| NOISE_DIRS.contains(&p.as_str())),
    }
}

/// Starts watching `projects`; `on_change(project)` runs on a background thread for each
/// project that changed and then stayed quiet for a moment.
pub fn start(projects: Vec<PathBuf>, on_change: impl Fn(&Path) + Send + 'static) -> Result<ProjectWatcher, String> {
    let (tx, rx) = mpsc::channel::<Vec<PathBuf>>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            let _ = tx.send(ev.paths);
        }
    })
    .map_err(|e| e.to_string())?;
    for p in &projects {
        // A project that vanished or can't be watched is simply skipped.
        let _ = watcher.watch(p, RecursiveMode::Recursive);
    }

    // Longest roots first so nested projects win over their parents.
    let mut roots = projects;
    roots.sort_by_key(|p| std::cmp::Reverse(p.as_os_str().len()));

    std::thread::spawn(move || {
        let mut pending: HashMap<PathBuf, Instant> = HashMap::new();
        loop {
            match rx.recv_timeout(Duration::from_millis(400)) {
                Ok(paths) => {
                    for path in paths {
                        if let Some(root) = roots.iter().find(|r| path.starts_with(r)) {
                            if relevant(root, &path) {
                                pending.insert(root.clone(), Instant::now());
                            }
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break, // watcher dropped
            }
            let ready: Vec<PathBuf> = pending.iter().filter(|(_, t)| t.elapsed() >= QUIET).map(|(p, _)| p.clone()).collect();
            for p in ready {
                pending.remove(&p);
                on_change(&p);
            }
        }
    });
    Ok(ProjectWatcher { _watcher: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_noise() {
        let root = Path::new("/p/app");
        assert!(relevant(root, Path::new("/p/app/src/main.rs")));
        assert!(relevant(root, Path::new("/p/app/.git/index")));
        assert!(relevant(root, Path::new("/p/app/.git/HEAD")));
        assert!(relevant(root, Path::new("/p/app/.git/refs/heads/main")));
        assert!(!relevant(root, Path::new("/p/app/.git/objects/ab/cdef")));
        assert!(!relevant(root, Path::new("/p/app/.git/index.lock")));
        assert!(!relevant(root, Path::new("/p/app/target/debug/app.exe")));
        assert!(!relevant(root, Path::new("/p/app/web/node_modules/x/index.js")));
        assert!(!relevant(root, Path::new("/p/other/file")));
    }

    #[test]
    fn reports_changes_after_quiet_period() {
        let dir = std::env::temp_dir().join(format!("devhub-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (tx, rx) = mpsc::channel();
        let w = start(vec![dir.clone()], move |p| {
            let _ = tx.send(p.to_path_buf());
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(dir.join("a.txt"), "1").unwrap();
        std::fs::write(dir.join("a.txt"), "2").unwrap();
        let got = rx.recv_timeout(Duration::from_secs(10)).expect("change reported");
        assert_eq!(got, dir);
        assert!(rx.recv_timeout(Duration::from_millis(2500)).is_err(), "burst reported once");
        drop(w);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
