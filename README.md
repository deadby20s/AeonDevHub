# Aeon Dev Hub

A small Tauri 2 desktop app that lists all your local projects with git status, last commit and TODOs, and opens any of them in your editor with one click.

## What it shows

- **Projects**: every git repo or folder with a project file (`Cargo.toml`, `package.json`, `pyproject.toml`, `go.mod`, `*.sln`, `src-tauri/`, …) under your project folders. Subfolders of a found project are not listed separately.
- **Git**: branch, ahead/behind upstream, staged/modified/untracked/conflicted counts, last commit (subject, author, age), and a link to the remote on the web.
- **TODOs**: `TODO`, `FIXME`, `HACK` and `XXX` comments in source files. It respects `.gitignore` and skips dependency/build folders and binaries. Click one to open that file at that line.
- **Actions**: open in editor, open a terminal there (Windows Terminal, or PowerShell if it isn't installed), show the folder in Explorer, pin to top, hide.

## Keyboard

| Key | Action |
| --- | --- |
| `/` or `Ctrl+K` | Search (then `Enter` opens the top match) |
| `↑` `↓` | Move the selection |
| `Enter` / double-click | Open in editor |
| `T` / `F` / `O` | Terminal / folder / remote on the web |
| `Space` | Show details and TODOs |
| `P` | Pin |
| `Ctrl+R` / `F5` | Rescan |
| `Ctrl+,` | Settings |

## Settings

Settings are stored in `%APPDATA%\dev.aeon.devhub\config.json`, and the last scan is cached in `%LOCALAPPDATA%\dev.aeon.devhub\projects.json` so the list shows up right away when the app starts.

- **Editor**: `code`, `cursor`, `windsurf`, `zed`, `codium`, `subl`, `idea`, or any command or full path to an executable. The VS Code family, Zed and Sublime open TODOs at the exact line.
- **Folder depth**: how many levels below each project folder to look for projects (default 3).

## Develop

You need Rust, the Tauri CLI (`cargo install tauri-cli`) and git on PATH. The frontend is plain HTML, CSS and JS in `ui/`, so there is no npm step.

```powershell
cd src-tauri
cargo tauri dev        # run with live reload
cargo tauri build      # installer → target/release/bundle/nsis/
cargo test             # unit tests
cargo test -- --ignored --nocapture   # smoke-scan this machine's default folders
```

Opening `ui/index.html` through any static server (for example `python -m http.server -d ui`) runs the UI with demo data.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion
in this project by you, as defined in the Apache-2.0 license, shall be dual licensed as above,
without any additional terms or conditions.
