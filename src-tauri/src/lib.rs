mod config;
mod git;
mod graph;
mod launch;
mod scan;
mod todos;

use config::Config;
use scan::Project;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    config: Mutex<Config>,
    config_path: PathBuf,
    cache_path: PathBuf,
    scanning: AtomicBool,
}

fn project_dir(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if p.is_dir() { Ok(p) } else { Err(format!("Folder not found: {path}")) }
}

#[tauri::command]
fn get_config(state: State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(state: State<AppState>, config: Config) -> Result<(), String> {
    config.save(&state.config_path)?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

#[tauri::command]
fn home_dir() -> Option<String> {
    config::home_dir().map(|p| p.display().to_string())
}

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
    let cfg = state.config.lock().unwrap().clone();
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
    result.map_err(|e| format!("Scan failed: {e}"))
}

#[tauri::command]
async fn scan_project(app: AppHandle, path: String) -> Result<Project, String> {
    let state = app.state::<AppState>();
    let with_todos = state.config.lock().unwrap().scan_todos;
    let cache = state.cache_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let project = scan::scan_project(project_dir(&path)?, with_todos);
        let mut all = scan::load_cache(&cache);
        if let Some(slot) = all.iter_mut().find(|p| p.path == project.path) {
            *slot = project.clone();
            scan::save_cache(&cache, &all);
        }
        Ok(project)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_in_editor(state: State<AppState>, path: String, file: Option<String>, line: Option<u32>) -> Result<(), String> {
    let editor = state.config.lock().unwrap().editor.clone();
    launch::open_in_editor(&editor, project_dir(&path)?, file.as_deref(), line)
}

#[tauri::command]
fn open_terminal(path: String) -> Result<(), String> {
    launch::open_terminal(project_dir(&path)?)
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    launch::open_folder(project_dir(&path)?)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    launch::open_url(&url)
}

/// Commit graph across all branches, newest first.
#[tauri::command]
async fn git_graph(path: String, limit: Option<usize>) -> Result<graph::Graph, String> {
    let limit = limit.unwrap_or(400).clamp(1, 20_000);
    tauri::async_runtime::spawn_blocking(move || graph::graph(project_dir(&path)?, limit))
        .await
        .map_err(|e| e.to_string())?
}

/// Where an editor command resolves to, if anywhere.
#[tauri::command]
fn check_editor(editor: String) -> Option<String> {
    launch::find_exe(&editor).map(|p| p.display().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("config.json");
            let cache_path = app.path().app_cache_dir()?.join("projects.json");
            let config = Config::load(&config_path);
            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
                cache_path,
                scanning: AtomicBool::new(false),
            });
            Ok(())
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
            git_graph,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aeon Dev Hub");
}
