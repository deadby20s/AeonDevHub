mod activity;
mod branches;
mod changes;
mod config;
mod fetch;
mod git;
mod github;
mod graph;
mod launch;
mod proc;
mod scan;
mod scripts;
mod todos;
mod watch;

use config::Config;
use scan::Project;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

struct AppState {
    config: Mutex<Config>,
    config_path: PathBuf,
    cache_path: PathBuf,
    gh_cache_path: PathBuf,
    scanning: AtomicBool,
    /// Project folders from the last full scan (what the watcher watches).
    paths: Mutex<Vec<PathBuf>>,
    watcher: Mutex<Option<watch::ProjectWatcher>>,
}

impl AppState {
    fn config(&self) -> Config {
        self.config.lock().unwrap().clone()
    }

    fn record_recent(&self, path: &str) {
        let mut c = self.config.lock().unwrap();
        c.touch_recent(path);
        let _ = c.save(&self.config_path);
    }
}

fn project_dir(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if p.is_dir() { Ok(p) } else { Err(format!("Folder not found: {path}")) }
}

/// Runs blocking work (git, file IO, network) off the async runtime.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/* ---------- window, tray, hotkey ---------- */

fn show_main(app: &AppHandle, focus_search: bool) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if focus_search {
            let _ = w.emit("focus-search", ());
        }
    }
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let shown = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
        if shown && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_main(app, true);
        }
    }
}

fn apply_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let h = hotkey.trim();
    if h.is_empty() {
        return Ok(());
    }
    gs.register(h).map_err(|e| format!("The shortcut \"{h}\" couldn't be registered ({e}). Pick another one in Settings."))
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Dev Hub", true, None::<&str>)?;
    let rescan = MenuItem::with_id(app, "rescan", "Rescan projects", true, None::<&str>)?;
    let fetch = MenuItem::with_id(app, "fetch", "Fetch all repos", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &rescan, &fetch, &sep, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Aeon Dev Hub")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "show" => show_main(app, true),
            "rescan" | "fetch" => {
                show_main(app, false);
                let _ = app.emit("tray-action", e.id.as_ref());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                toggle_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/* ---------- watcher ---------- */

fn restart_watcher(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut slot = state.watcher.lock().unwrap();
    *slot = None; // stop the old one first
    if !state.config.lock().unwrap().auto_refresh {
        return;
    }
    let paths = state.paths.lock().unwrap().clone();
    if paths.is_empty() {
        return;
    }
    let handle = app.clone();
    let started = watch::start(paths, move |dir| {
        let state = handle.state::<AppState>();
        if state.scanning.load(Ordering::SeqCst) {
            return; // a full scan is about to report this anyway
        }
        let with_todos = state.config.lock().unwrap().scan_todos;
        let project = scan::scan_project(dir, with_todos);
        let _ = handle.emit("project-updated", project);
    });
    *slot = started.ok();
}

/* ---------- settings ---------- */

#[tauri::command]
fn get_config(state: State<AppState>) -> Config {
    state.config()
}

#[tauri::command]
fn save_config(app: AppHandle, state: State<AppState>, config: Config) -> Result<(), String> {
    let old = state.config();
    config.save(&state.config_path)?;
    *state.config.lock().unwrap() = config.clone();
    if old.auto_refresh != config.auto_refresh {
        restart_watcher(&app);
    }
    if old.hotkey != config.hotkey {
        apply_hotkey(&app, &config.hotkey).map_err(|e| format!("Settings saved, but: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn home_dir() -> Option<String> {
    config::home_dir().map(|p| p.display().to_string())
}

/* ---------- scanning ---------- */

#[tauri::command]
fn load_cached(state: State<AppState>) -> Vec<Project> {
    scan::load_cache(&state.cache_path)
}

#[tauri::command]
async fn scan_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    let state = app.state::<AppState>();
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("A scan is already running".into());
    }
    let cfg = state.config();
    let cache = state.cache_path.clone();
    let emitter = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let projects = scan::scan_all(&cfg, &|done, total| {
            let _ = emitter.emit("scan-progress", (done, total));
        });
        scan::save_cache(&cache, &projects);
        projects
    })
    .await;
    state.scanning.store(false, Ordering::SeqCst);
    let projects = result.map_err(|e| format!("Scan failed: {e}"))?;
    *state.paths.lock().unwrap() = projects.iter().map(|p| PathBuf::from(&p.path)).collect();
    restart_watcher(&app);
    Ok(projects)
}

#[tauri::command]
async fn scan_project(app: AppHandle, path: String) -> Result<Project, String> {
    let state = app.state::<AppState>();
    let with_todos = state.config.lock().unwrap().scan_todos;
    let cache = state.cache_path.clone();
    blocking(move || {
        let project = scan::scan_project(project_dir(&path)?, with_todos);
        let mut all = scan::load_cache(&cache);
        if let Some(slot) = all.iter_mut().find(|p| p.path == project.path) {
            *slot = project.clone();
            scan::save_cache(&cache, &all);
        }
        Ok(project)
    })
    .await
}

/* ---------- launching ---------- */

#[tauri::command]
fn open_in_editor(state: State<AppState>, path: String, file: Option<String>, line: Option<u32>) -> Result<(), String> {
    let editor = state.config.lock().unwrap().editor.clone();
    launch::open_in_editor(&editor, project_dir(&path)?, file.as_deref(), line)?;
    state.record_recent(&path);
    Ok(())
}

#[tauri::command]
fn open_terminal(state: State<AppState>, path: String) -> Result<(), String> {
    launch::open_terminal(project_dir(&path)?)?;
    state.record_recent(&path);
    Ok(())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    launch::open_folder(project_dir(&path)?)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    launch::open_url(&url)
}

/// Where an editor command resolves to, if anywhere.
#[tauri::command]
fn check_editor(editor: String) -> Option<String> {
    launch::find_exe(&editor).map(|p| p.display().to_string())
}

#[tauri::command]
async fn project_scripts(path: String) -> Result<Vec<scripts::Script>, String> {
    blocking(move || Ok(scripts::list(project_dir(&path)?))).await
}

#[tauri::command]
fn run_script(state: State<AppState>, path: String, id: String) -> Result<(), String> {
    scripts::run(project_dir(&path)?, &id)?;
    state.record_recent(&path);
    Ok(())
}

/* ---------- git ---------- */

/// Commit graph across all branches, newest first.
#[tauri::command]
async fn git_graph(path: String, limit: Option<usize>) -> Result<graph::Graph, String> {
    let limit = limit.unwrap_or(400).clamp(1, 20_000);
    blocking(move || graph::graph(project_dir(&path)?, limit)).await
}

#[tauri::command]
async fn fetch_all(app: AppHandle, paths: Vec<String>) -> Result<Vec<fetch::FetchResult>, String> {
    let dirs: Vec<PathBuf> = paths.iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
    blocking(move || {
        Ok(fetch::fetch_all(&dirs, &|done, total| {
            let _ = app.emit("fetch-progress", (done, total));
        }))
    })
    .await
}

#[tauri::command]
async fn stale_branches(path: String) -> Result<branches::Stale, String> {
    blocking(move || branches::stale(project_dir(&path)?)).await
}

#[tauri::command]
async fn delete_branches(path: String, names: Vec<String>, force: bool) -> Result<Vec<branches::DeleteResult>, String> {
    blocking(move || branches::delete(project_dir(&path)?, &names, force)).await
}

#[tauri::command]
async fn changed_files(path: String) -> Result<Vec<changes::FileChange>, String> {
    blocking(move || changes::changes(project_dir(&path)?)).await
}

#[tauri::command]
async fn file_diff(path: String, file: String, staged: bool) -> Result<changes::Diff, String> {
    blocking(move || changes::diff(project_dir(&path)?, &file, staged)).await
}

#[tauri::command]
async fn activity(paths: Vec<String>, days: Option<u32>) -> Result<Vec<activity::ProjectActivity>, String> {
    let since = now() - i64::from(days.unwrap_or(371)) * 86_400;
    let dirs: Vec<PathBuf> = paths.iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
    blocking(move || Ok(activity::all(&dirs, since))).await
}

/* ---------- GitHub ---------- */

#[derive(Deserialize)]
struct GhRequest {
    path: String,
    branch: Option<String>,
}

fn load_gh_cache(path: &Path) -> HashMap<String, github::GithubInfo> {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[tauri::command]
fn github_available() -> bool {
    github::available()
}

#[tauri::command]
fn github_cached(state: State<AppState>) -> HashMap<String, github::GithubInfo> {
    load_gh_cache(&state.gh_cache_path)
}

#[tauri::command]
async fn github_info(app: AppHandle, repos: Vec<GhRequest>) -> Result<HashMap<String, github::GithubInfo>, String> {
    let cache_path = app.state::<AppState>().gh_cache_path.clone();
    blocking(move || {
        let repos: Vec<GhRequest> = repos.into_iter().filter(|r| Path::new(&r.path).is_dir()).collect();
        let infos = proc::parallel(&repos, 4, |r| github::info(Path::new(&r.path), r.branch.as_deref()), &|_, _| {});
        let fresh: HashMap<String, github::GithubInfo> = repos.iter().map(|r| r.path.clone()).zip(infos).collect();
        let mut cache = load_gh_cache(&cache_path);
        cache.extend(fresh.clone());
        if let Ok(json) = serde_json::to_string(&cache) {
            let _ = std::fs::write(&cache_path, json);
        }
        Ok(fresh)
    })
    .await
}

pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just brings the running window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app, true)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("config.json");
            let cache_dir = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&cache_dir)?;
            let config = Config::load(&config_path);
            let hotkey = config.hotkey.clone();
            let paths = scan::load_cache(&cache_dir.join("projects.json")).into_iter().map(|p| PathBuf::from(p.path)).collect();
            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
                cache_path: cache_dir.join("projects.json"),
                gh_cache_path: cache_dir.join("github.json"),
                scanning: AtomicBool::new(false),
                paths: Mutex::new(paths),
                watcher: Mutex::new(None),
            });
            build_tray(app)?;
            if let Err(e) = apply_hotkey(app.handle(), &hotkey) {
                eprintln!("{e}");
            }
            restart_watcher(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<AppState>().config.lock().unwrap().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            home_dir,
            load_cached,
            scan_projects,
            scan_project,
            open_in_editor,
            open_terminal,
            open_folder,
            open_url,
            check_editor,
            project_scripts,
            run_script,
            git_graph,
            fetch_all,
            stale_branches,
            delete_branches,
            changed_files,
            file_diff,
            activity,
            github_available,
            github_cached,
            github_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aeon Dev Hub");
}
