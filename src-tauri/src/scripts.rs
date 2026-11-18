//! Detecting runnable project scripts (npm, cargo, make, just, go, deno, dotnet, pytest).
use regex::Regex;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Script {
    /// Stable id used to run it; the command itself never comes from the UI.
    pub id: String,
    pub group: String,
    pub name: String,
    /// What gets run, for display.
    pub command: String,
    /// Folder it runs in, relative to the project ("" = project root).
    pub cwd: String,
}

pub struct Spec {
    pub script: Script,
    pub argv: Vec<String>,
    pub dir: PathBuf,
}

const MAX_PER_GROUP: usize = 40;

fn spec(group: &str, name: &str, argv: &[&str], root: &Path, sub: &str) -> Spec {
    let command = argv.join(" ");
    let mut argv: Vec<String> = argv.iter().map(|s| s.to_string()).collect();
    // In PowerShell, `npm` resolves to npm.ps1, which the default execution policy blocks.
    if cfg!(windows) && ["npm", "pnpm", "yarn", "npx"].contains(&argv[0].as_str()) {
        argv[0].push_str(".cmd");
    }
    Spec {
        script: Script {
            id: format!("{group}\u{1f}{name}\u{1f}{sub}"),
            group: group.into(),
            name: name.into(),
            command,
            cwd: sub.into(),
        },
        argv,
        dir: if sub.is_empty() { root.to_path_buf() } else { root.join(sub) },
    }
}

fn node_runner(dir: &Path) -> &'static str {
    if dir.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if dir.join("yarn.lock").exists() {
        "yarn"
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        "bun"
    } else {
        "npm"
    }
}

static MAKE_TARGET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([A-Za-z0-9][A-Za-z0-9_.\-/]*)\s*:([^=]|$)").unwrap());
static JUST_RECIPE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^@?([A-Za-z0-9_][A-Za-z0-9_\-]*)(\s+[^:]*)?:([^=]|$)").unwrap());

pub fn detect(root: &Path) -> Vec<Spec> {
    let mut out = Vec::new();

    // package.json scripts, in file order.
    if let Ok(s) = fs::read_to_string(root.join("package.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
            let runner = node_runner(root);
            if let Some(scripts) = v.get("scripts").and_then(|s| s.as_object()) {
                for name in scripts.keys().take(MAX_PER_GROUP) {
                    let argv: Vec<&str> = if runner == "npm" { vec!["npm", "run", name] } else { vec![runner, name] };
                    out.push(spec(runner, name, &argv, root, ""));
                }
            }
        }
    }

    // deno.json tasks.
    for f in ["deno.json", "deno.jsonc"] {
        if let Ok(s) = fs::read_to_string(root.join(f)) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                if let Some(tasks) = v.get("tasks").and_then(|t| t.as_object()) {
                    for name in tasks.keys().take(MAX_PER_GROUP) {
                        out.push(spec("deno", name, &["deno", "task", name], root, ""));
                    }
                }
            }
        }
    }

    // Cargo, at the root and in a Tauri app's src-tauri folder.
    if root.join("Cargo.toml").exists() {
        for cmd in ["build", "run", "test", "check", "clippy"] {
            out.push(spec("cargo", cmd, &["cargo", cmd], root, ""));
        }
    }
    let tauri = root.join("src-tauri");
    if tauri.join("tauri.conf.json").exists() || tauri.join("Tauri.toml").exists() {
        for cmd in ["dev", "build"] {
            out.push(spec("tauri", cmd, &["cargo", "tauri", cmd], root, "src-tauri"));
        }
        if !root.join("Cargo.toml").exists() {
            out.push(spec("tauri", "test", &["cargo", "test"], root, "src-tauri"));
        }
    }

    // Makefile targets.
    for f in ["Makefile", "makefile", "GNUmakefile"] {
        if let Ok(s) = fs::read_to_string(root.join(f)) {
            let mut seen = Vec::new();
            for line in s.lines() {
                if let Some(c) = MAKE_TARGET.captures(line) {
                    let t = c[1].to_string();
                    if !t.contains('%') && !seen.contains(&t) {
                        seen.push(t);
                    }
                }
            }
            for t in seen.iter().take(MAX_PER_GROUP) {
                out.push(spec("make", t, &["make", t], root, ""));
            }
            break;
        }
    }

    // justfile recipes.
    for f in ["justfile", "Justfile", ".justfile"] {
        if let Ok(s) = fs::read_to_string(root.join(f)) {
            let mut seen = Vec::new();
            for line in s.lines() {
                if line.starts_with(['#', ' ', '\t']) || ["set ", "alias ", "export ", "import ", "mod "].iter().any(|p| line.starts_with(p)) {
                    continue;
                }
                if let Some(c) = JUST_RECIPE.captures(line) {
                    let r = c[1].to_string();
                    if !seen.contains(&r) {
                        seen.push(r);
                    }
                }
            }
            for r in seen.iter().take(MAX_PER_GROUP) {
                out.push(spec("just", r, &["just", r], root, ""));
            }
            break;
        }
    }

    if root.join("go.mod").exists() {
        out.push(spec("go", "run", &["go", "run", "."], root, ""));
        out.push(spec("go", "test", &["go", "test", "./..."], root, ""));
        out.push(spec("go", "build", &["go", "build", "./..."], root, ""));
    }

    let has_dotnet = fs::read_dir(root).map_or(false, |rd| {
        rd.flatten().any(|e| {
            let n = e.file_name().to_string_lossy().to_ascii_lowercase();
            n.ends_with(".sln") || n.ends_with(".csproj") || n.ends_with(".fsproj")
        })
    });
    if has_dotnet {
        for cmd in ["build", "run", "test"] {
            out.push(spec("dotnet", cmd, &["dotnet", cmd], root, ""));
        }
    }

    if (root.join("pyproject.toml").exists() || root.join("requirements.txt").exists())
        && (root.join("tests").is_dir() || root.join("test").is_dir())
    {
        out.push(spec("python", "pytest", &["python", "-m", "pytest"], root, ""));
    }

    out
}

pub fn list(root: &Path) -> Vec<Script> {
    detect(root).into_iter().map(|s| s.script).collect()
}

pub fn run(root: &Path, id: &str) -> Result<(), String> {
    let spec = detect(root)
        .into_iter()
        .find(|s| s.script.id == id)
        .ok_or("That script no longer exists in the project.")?;
    let title = format!("{} · {}", root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), spec.script.name);
    crate::launch::run_in_terminal(&spec.dir, &spec.argv, &title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_scripts() {
        let dir = std::env::temp_dir().join(format!("devhub-scripts-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src-tauri")).unwrap();
        fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"vite","build":"vite build","lint":"eslint ."}}"#).unwrap();
        fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        fs::write(dir.join("src-tauri/tauri.conf.json"), "{}").unwrap();
        fs::write(dir.join("Makefile"), ".PHONY: all\nall: build\nbuild:\n\tcc x.c\n%.o: %.c\n\tcc\nVAR := 1\ntest: build\n").unwrap();
        fs::write(dir.join("justfile"), "set shell := [\"sh\"]\n# comment\ndefault:\n  echo\n@deploy env='x':\n  echo\nv := '1'\n").unwrap();

        let s = list(&dir);
        let _ = fs::remove_dir_all(&dir);
        let names: Vec<String> = s.iter().map(|s| format!("{}:{}", s.group, s.name)).collect();
        assert_eq!(
            names,
            vec![
                "pnpm:dev", "pnpm:build", "pnpm:lint", "tauri:dev", "tauri:build", "tauri:test",
                "make:all", "make:build", "make:test", "just:default", "just:deploy",
            ]
        );
        assert_eq!(s[0].command, "pnpm dev");
        assert_eq!(s[3].cwd, "src-tauri");
    }
}
