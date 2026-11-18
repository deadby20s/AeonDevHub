use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// User settings, stored as JSON in the app config dir.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    /// Folders to search for projects.
    pub roots: Vec<String>,
    /// Editor command or full path to its executable (e.g. `code`, `cursor`, `zed`).
    pub editor: String,
    /// How many folder levels below a root to look for projects.
    pub scan_depth: u32,
    /// Whether to scan source files for TODO, FIXME, HACK and XXX comments.
    pub scan_todos: bool,
    /// Project paths hidden from the list.
    pub hidden: Vec<String>,
    /// Project paths pinned to the top.
    pub pinned: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            roots: default_roots(),
            editor: "code".into(),
            scan_depth: 3,
            scan_todos: true,
            hidden: Vec::new(),
            pinned: Vec::new(),
        }
    }
}

impl Config {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| format!("Could not save settings: {e}"))
    }
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Common places people keep code, if they exist.
fn default_roots() -> Vec<String> {
    let Some(home) = home_dir() else { return Vec::new() };
    [
        "Documents/projects",
        "Documents/GitHub",
        "projects",
        "Projects",
        "dev",
        "code",
        "src",
        "repos",
        "source/repos",
    ]
    .iter()
    .map(|rel| home.join(rel))
    .filter(|p| p.is_dir())
    .map(|p| p.display().to_string().replace('/', std::path::MAIN_SEPARATOR_STR))
    .fold(Vec::new(), |mut acc, p| {
        // "projects" and "Projects" are the same folder on Windows/macOS.
        if !acc.iter().any(|a: &String| a.eq_ignore_ascii_case(&p)) {
            acc.push(p);
        }
        acc
    })
}
