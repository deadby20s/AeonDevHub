# Aeon Dev Hub

A small Tauri 2 desktop app that lists all your local projects with git status, last commit and TODOs, and opens any of them in your editor with one click.

## What it shows

- **Projects**: every git repo or folder with a project file (`Cargo.toml`, `package.json`, `pyproject.toml`, `go.mod`, `*.sln`, `src-tauri/`, …) under your project folders. Subfolders of a found project are not listed separately.
- **Git**: branch, ahead/behind upstream, staged/modified/untracked/conflicted counts, last commit (subject, author, age), and a link to the remote on the web.
- **TODOs**: `TODO`, `FIXME`, `HACK` and `XXX` comments in source files. It respects `.gitignore` and skips dependency/build folders and binaries. Click one to open that file at that line.
- **Branch graph**: a full-window view of a repo's history across all branches, drawn as lanes with merges, tags and remote branches. A sidebar lists local and remote branches with ahead/behind counts and deleted upstreams; click one to jump to its latest commit. It loads the latest 400 commits, and you can load older ones.
- **Changes**: click a project's "changed" badge to see its uncommitted files (staged, unstaged, untracked, conflicts) with a diff of each. Read-only; **Open file** jumps to the first changed line.
- **Branch cleanup**: lists local branches that are merged into the default branch or whose upstream was deleted, and deletes the ones you tick. Unmerged branches are never pre-selected and are flagged; remote branches are never touched.
- **Fetch all**: runs `git fetch --all --prune` on every repo with a remote, then rescans so the ↓ counts are real. It never prompts for credentials; repos that fail are listed.
- **GitHub**: open PRs (with "your review" and approval state) and the latest CI run for each GitHub repo, through the `gh` CLI you're already signed in to.
- **Scripts**: `package.json` scripts (npm/pnpm/yarn/bun), cargo, `cargo tauri`, Makefile targets, justfile recipes, go, deno tasks, dotnet and pytest. Click one to run it in a new terminal tab.
- **Notes**: a note per project, shown in the list and included in search.
- **Activity**: a year-long heatmap of your commits across every project, streaks, per-project 12-week activity, plus projects with work waiting and dormant ones.
- **Recently opened**: sort by the projects you last opened from Dev Hub.
- **Auto-refresh**: a file watcher rescans a project about 1.5 s after its files or git state change (build folders like `target` and `node_modules` are ignored).
- **Tray and global shortcut**: `Ctrl+Alt+Space` (configurable) shows or hides Dev Hub from anywhere and focuses search. Closing the window keeps it in the tray; quit from the tray menu. Launching it again brings the existing window forward.
- **Actions**: open in editor, open a terminal there (Windows Terminal, or PowerShell if it isn't installed), show the folder in Explorer, pin to top, hide.

## Keyboard

| Key | Action |
| --- | --- |
| `/` or `Ctrl+K` | Search (then `Enter` opens the top match) |
| `↑` `↓` | Move the selection |
| `Enter` / double-click | Open in editor |
| `T` / `F` / `O` | Terminal / folder / remote on the web |
| `Space` | Show details and TODOs |
| `B` | Branch graph (in the graph: `↑` `↓` move, `→` first parent, `Shift+→` merged branch, `Esc` back) |
| `C` | Changes (in the view: `↑` `↓` files, `Enter` open file, `Esc` back) |
| `N` | Edit the project's note |
| `A` | Activity |
| `Shift+F` | Fetch all |
| `P` | Pin |
| `Ctrl+R` / `F5` | Rescan |
| `Ctrl+Alt+Space` | Show/hide Dev Hub from anywhere (configurable) |
| `Ctrl+,` | Settings |

## Settings

Settings are stored in `%APPDATA%\dev.aeon.devhub\config.json`, and the last scan is cached in `%LOCALAPPDATA%\dev.aeon.devhub\projects.json` so the list shows up right away when the app starts.

- **Editor**: `code`, `cursor`, `windsurf`, `zed`, `codium`, `subl`, `idea`, or any command or full path to an executable. The VS Code family, Zed and Sublime open TODOs at the exact line.
- **Folder depth**: how many levels below each project folder to look for projects (default 3).
- **Auto-refresh**, **GitHub PRs and CI**, **close to tray**: on by default; each can be turned off.
- **Global shortcut**: click the field and press the keys you want; Backspace clears it.

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
