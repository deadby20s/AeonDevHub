//! Starting external programs: editor, terminal, file manager, browser.
use std::path::{MAIN_SEPARATOR_STR, Path, PathBuf};
use std::process::Command;

/// Don't flash a console window for child processes on Windows.
pub fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

fn exists(p: &Path) -> bool {
    // symlink_metadata so Windows app-execution aliases (e.g. wt.exe) count.
    p.symlink_metadata().is_ok_and(|m| !m.is_dir())
}

/// Resolve a command name the way a shell would (PATH + PATHEXT), or accept a full path.
pub fn find_exe(name: &str) -> Option<PathBuf> {
    let name = name.trim().trim_matches('"');
    if name.is_empty() {
        return None;
    }
    let p = Path::new(name);
    if p.is_absolute() || p.components().count() > 1 {
        return exists(p).then(|| p.to_path_buf());
    }
    let exts: Vec<String> = if cfg!(windows) && p.extension().is_none() {
        // Never take the extensionless file: VS Code ships a `code` shell script next to code.cmd.
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|s| !s.is_empty())
            .map(str::to_ascii_lowercase)
            .collect()
    } else {
        vec![String::new()]
    };
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for ext in &exts {
                let c = dir.join(format!("{name}{ext}"));
                if exists(&c) {
                    return Some(c);
                }
            }
        }
    }
    known_location(name)
}

/// Default install locations for editors that may not be on PATH.
fn known_location(name: &str) -> Option<PathBuf> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let candidates: Vec<PathBuf> = match name.to_ascii_lowercase().as_str() {
        "code" if cfg!(windows) => [
            env("LOCALAPPDATA").map(|d| d.join(r"Programs\Microsoft VS Code\bin\code.cmd")),
            env("ProgramFiles").map(|d| d.join(r"Microsoft VS Code\bin\code.cmd")),
        ]
        .into_iter()
        .flatten()
        .collect(),
        "cursor" if cfg!(windows) => env("LOCALAPPDATA")
            .map(|d| d.join(r"Programs\cursor\resources\app\bin\cursor.cmd"))
            .into_iter()
            .collect(),
        "code" if cfg!(target_os = "macos") => vec![PathBuf::from(
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        )],
        _ => Vec::new(),
    };
    candidates.into_iter().find(|p| exists(p))
}

enum Goto {
    /// `editor <folder> -g file:line` (VS Code family)
    Flag,
    /// `editor <folder> file:line` (Zed, Sublime)
    Suffix,
    /// `editor file`
    Plain,
}

fn goto_style(exe: &Path) -> Goto {
    let stem = exe.file_stem().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    match stem.as_str() {
        "code" | "code-insiders" | "cursor" | "windsurf" | "codium" | "vscodium" | "positron" | "trae" => Goto::Flag,
        "zed" | "subl" | "sublime_text" => Goto::Suffix,
        _ => Goto::Plain,
    }
}

fn spawn(mut cmd: Command, what: &str) -> Result<(), String> {
    cmd.spawn().map(drop).map_err(|e| format!("Could not start {what}: {e}"))
}

pub fn open_in_editor(editor: &str, project: &Path, file: Option<&str>, line: Option<u32>) -> Result<(), String> {
    let exe = find_exe(editor).ok_or_else(|| {
        format!("Editor \"{editor}\" was not found. Set the editor command (or its full path) in Settings.")
    })?;
    let mut cmd = Command::new(&exe);
    cmd.current_dir(project);
    no_window(&mut cmd);
    match file {
        None => {
            cmd.arg(project);
        }
        Some(f) => {
            let full = project.join(f.replace('/', MAIN_SEPARATOR_STR));
            let target = match line {
                Some(l) => format!("{}:{l}", full.display()),
                None => full.display().to_string(),
            };
            match goto_style(&exe) {
                Goto::Flag => {
                    cmd.arg(project).arg("-g").arg(target);
                }
                Goto::Suffix => {
                    cmd.arg(project).arg(target);
                }
                Goto::Plain => {
                    cmd.arg(full);
                }
            }
        }
    }
    spawn(cmd, &exe.display().to_string())
}

pub fn open_terminal(dir: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Some(wt) = find_exe("wt") {
            let mut c = Command::new(wt);
            c.arg("-d").arg(dir);
            return spawn(c, "Windows Terminal");
        }
        let mut c = Command::new("powershell.exe");
        c.arg("-NoExit").current_dir(dir).creation_flags(0x0000_0010); // CREATE_NEW_CONSOLE
        spawn(c, "PowerShell")
    }
    #[cfg(target_os = "macos")]
    {
        let mut c = Command::new("open");
        c.args(["-a", "Terminal"]).arg(dir);
        spawn(c, "Terminal")
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut c = Command::new("x-terminal-emulator");
        c.current_dir(dir);
        spawn(c, "terminal")
    }
}

pub fn open_folder(dir: &Path) -> Result<(), String> {
    let prog = if cfg!(windows) { "explorer.exe" } else if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    let mut c = Command::new(prog);
    c.arg(dir);
    spawn(c, prog)
}

pub fn open_url(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") || url.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err("Only https:// links can be opened".into());
    }
    let mut c = if cfg!(windows) {
        let mut c = Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler");
        c
    } else if cfg!(target_os = "macos") {
        Command::new("open")
    } else {
        Command::new("xdg-open")
    };
    c.arg(url);
    spawn(c, "browser")
}
