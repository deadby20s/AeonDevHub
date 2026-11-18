'use strict';

/* ---------- Tauri bridge (with a demo fallback for opening ui/ in a plain browser) ---------- */
const TAURI = window.__TAURI__;
const invoke = TAURI ? TAURI.core.invoke : demoInvoke;
const listen = TAURI ? TAURI.event.listen : async () => () => {};

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem('devhub.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('devhub.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10"/><path d="M18 9c0 5-7 4-11.3 8.4"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  external: '<path d="M14 4h6v6M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  graph: '<circle cx="12" cy="19" r="2.5"/><circle cx="6" cy="5" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M6 7.5v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.5M12 12v4.5"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 2 3.5 3.5 0 0 1 0 7z"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.8 3.6M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19a9 9 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

const EDITORS = [
  ['code', 'VS Code'], ['cursor', 'Cursor'], ['windsurf', 'Windsurf'], ['zed', 'Zed'],
  ['codium', 'VSCodium'], ['subl', 'Sublime Text'], ['idea', 'IntelliJ IDEA'], ['', 'Custom…'],
];
const editorName = () => {
  const cmd = state.config?.editor || 'code';
  return EDITORS.find(([c]) => c && c === cmd)?.[1] || cmd.split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '');
};

function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  const steps = [[3600, 60, 'm'], [86400, 3600, 'h'], [604800, 86400, 'd'], [2629800, 604800, 'w'], [31557600, 2629800, 'mo']];
  for (const [lim, div, u] of steps) if (s < lim) return `${Math.floor(s / div)}${u} ago`;
  return `${Math.floor(s / 31557600)}y ago`;
}

/** git remote → https web URL (GitHub, GitLab, Bitbucket, Gitea…). */
function webUrl(u) {
  if (!u) return null;
  let m;
  if ((m = u.match(/^[\w.-]+@([^:/]+):(.+?)(?:\.git)?\/?$/))) return `https://${m[1]}/${m[2]}`;
  if ((m = u.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/))) return `https://${m[1]}/${m[2]}`;
  if ((m = u.match(/^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?\/?$/))) return `https://${m[1]}`;
  return null;
}

const changes = (p) => { const g = p.git; return g && !g.error ? g.staged + g.modified + g.untracked + g.conflicts : 0; };
const activity = (p) => p.git?.lastCommit?.timestamp || p.modified || 0;
const unsynced = (p) => { const g = p.git; return !!g && !g.error && (g.ahead > 0 || g.behind > 0 || (!g.upstream && !!g.remoteUrl && !!g.lastCommit)); };

/* ---------- state ---------- */
const state = {
  projects: [],
  config: null,
  home: null,
  filter: store.get('filter', 'all'),
  sort: store.get('sort', 'recent'),
  query: '',
  expanded: new Set(),
  selected: null,
  view: [],
  scanning: false,
  lastScan: 0,
};
const byPath = (path) => state.projects.find((p) => p.path === path);
const isPinned = (p) => state.config.pinned.includes(p.path);

const FILTERS = {
  all: () => true,
  dirty: (p) => changes(p) > 0,
  sync: unsynced,
  todos: (p) => p.todoCount > 0,
  nogit: (p) => !p.git,
};

function shortPath(path) {
  const h = state.home;
  if (h && path.toLowerCase().startsWith(h.toLowerCase())) return '~' + path.slice(h.length);
  return path;
}

function visible() {
  const hidden = new Set(state.config.hidden);
  const tokens = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  const nameHit = (p) => tokens.every((t) => p.name.toLowerCase().includes(t));
  let list = state.projects.filter((p) => !hidden.has(p.path) && FILTERS[state.filter](p));
  if (tokens.length) {
    list = list.filter((p) => {
      const hay = [p.name, shortPath(p.path), p.git?.branch, p.git?.lastCommit?.subject, ...p.kinds].join(' ').toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }
  const cmp = {
    recent: (a, b) => activity(b) - activity(a),
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    changes: (a, b) => changes(b) - changes(a) || activity(b) - activity(a),
    todos: (a, b) => b.todoCount - a.todoCount || activity(b) - activity(a),
  }[state.sort];
  return list.sort((a, b) =>
    (tokens.length ? nameHit(b) - nameHit(a) : 0) || isPinned(b) - isPinned(a) || cmp(a, b));
}

/* ---------- rendering ---------- */
function statusBadge(g) {
  if (!g) return '<span class="badge muted">no git</span>';
  if (g.error) return `<span class="badge red" title="${esc(g.error)}">git error</span>`;
  if (g.conflicts) return `<span class="badge red">${g.conflicts} conflict${g.conflicts > 1 ? 's' : ''}</span>`;
  const n = g.staged + g.modified + g.untracked;
  if (!n) return '<span class="badge green">clean</span>';
  const parts = [g.staged && `${g.staged} staged`, g.modified && `${g.modified} modified`, g.untracked && `${g.untracked} untracked`].filter(Boolean);
  return `<span class="badge amber" title="${parts.join(', ')}">${n} changed</span>`;
}

function rowHtml(p) {
  const g = p.git;
  const open = state.expanded.has(p.path);
  const pinned = isPinned(p);
  let branch = '<span class="faint">—</span>';
  if (g && !g.error) {
    const name = g.branch === '(detached)' ? 'detached' : g.branch || '?';
    const tip = g.upstream ? `tracking ${g.upstream}` : g.remoteUrl ? 'not pushed (no upstream)' : 'local only';
    branch = `<span class="branch" title="${esc(tip)}">${icon('branch')}<span class="mono ellipsis">${esc(name)}</span></span>`
      + (g.ahead ? `<span class="ab up" title="${g.ahead} commit(s) to push">↑${g.ahead}</span>` : '')
      + (g.behind ? `<span class="ab down" title="${g.behind} commit(s) to pull">↓${g.behind}</span>` : '');
  }
  const c = g?.lastCommit;
  const commit = c
    ? `<span class="ellipsis" title="${esc(c.subject)}&#10;${esc(c.author)} · ${esc(c.hash)}">${esc(c.subject)}</span><span class="faint" title="${esc(new Date(c.timestamp * 1000).toLocaleString())}">${ago(c.timestamp)}</span>`
    : `<span class="faint">${g && !g.error ? 'no commits yet' : ''}</span>`;
  const todo = p.todoCount
    ? `<button class="todo-count" data-action="expand" title="Show TODOs">${p.todoCount}</button>`
    : '<span class="faint mono">0</span>';
  const web = webUrl(g?.remoteUrl);
  return `<div class="row${state.selected === p.path ? ' selected' : ''}${open ? ' open' : ''}" data-path="${esc(p.path)}">
    <button class="icon-btn star${pinned ? ' on' : ''}" data-action="pin" title="${pinned ? 'Unpin' : 'Pin to top'} (P)">${icon('star')}</button>
    <div class="col-name">
      <div class="name"><span class="ellipsis">${esc(p.name)}</span>${p.kinds.map((k) => `<span class="kind">${esc(k)}</span>`).join('')}</div>
      <div class="path ellipsis" title="${esc(p.path)}">${esc(shortPath(p.path))}</div>
    </div>
    <div class="col-branch">${branch}</div>
    <div class="col-status">${statusBadge(g)}</div>
    <div class="col-commit">${commit}</div>
    <div class="col-todo">${todo}</div>
    <div class="col-actions">
      <button class="btn primary sm" data-action="open" title="Open in ${esc(editorName())} (Enter)">${icon('code')}<span>Open</span></button>
      <button class="icon-btn" data-action="graph" ${g && !g.error ? 'title="Branch graph (B)"' : 'disabled title="Not a git repo"'}>${icon('graph')}</button>
      <button class="icon-btn" data-action="term" title="Open terminal here (T)">${icon('terminal')}</button>
      <button class="icon-btn" data-action="folder" title="Show in file manager (F)">${icon('folder')}</button>
      <button class="icon-btn" data-action="web" ${web ? `title="${esc(web)}"` : 'disabled title="No remote"'}>${icon('external')}</button>
      <button class="icon-btn chev" data-action="expand" title="Details (Space)">${icon('chevron')}</button>
    </div>
  </div>${open ? detailsHtml(p) : ''}`;
}

function detailsHtml(p) {
  const g = p.git;
  const rows = [['Path', `<span class="mono selectable">${esc(p.path)}</span>`]];
  if (g?.error) rows.push(['Git', `<span class="selectable" style="color:var(--red)">${esc(g.error)}</span>`]);
  if (g && !g.error) {
    rows.push(['Branch', `<span class="mono">${esc(g.branch || '?')}</span>${g.upstream ? ` <span class="faint">→ ${esc(g.upstream)}</span>` : ' <span class="faint">(no upstream)</span>'}${g.ahead || g.behind ? ` <span class="faint">· ${g.ahead} ahead, ${g.behind} behind</span>` : ''}`]);
    rows.push(['Working tree', `${g.staged} staged · ${g.modified} modified · ${g.untracked} untracked${g.conflicts ? ` · <b style="color:var(--red)">${g.conflicts} conflicted</b>` : ''}`]);
    if (g.lastCommit) {
      const c = g.lastCommit;
      rows.push(['Last commit', `<span class="selectable"><span class="mono">${esc(c.hash)}</span> ${esc(c.subject)} <span class="faint">— ${esc(c.author)}, ${esc(new Date(c.timestamp * 1000).toLocaleString())}</span></span>`]);
    }
    if (g.remoteUrl) rows.push(['Remote', `<span class="mono selectable">${esc(g.remoteUrl)}</span>`]);
  }
  let todos = '';
  if (p.todoCount) {
    const items = p.todos.map((t, i) => `<button class="todo" data-action="todo" data-i="${i}" title="Open ${esc(t.file)}:${t.line}">
        <span class="tk ${t.kind.toLowerCase()}">${t.kind}</span>
        <span class="loc mono"><bdi>${esc(t.file)}:${t.line}</bdi></span>
        <span class="txt">${t.text ? esc(t.text) : '<i class="faint">(no description)</i>'}</span>
      </button>`).join('');
    const more = p.todoCount > p.todos.length ? `<div class="more">Showing the first ${p.todos.length} of ${p.todoCount}.</div>` : '';
    todos = `<div class="todos"><div class="todos-head">TODOs · ${p.todoCount} — click one to open it in ${esc(editorName())}</div><div class="todos-scroll">${items}${more}</div></div>`;
  }
  return `<div class="details" data-path="${esc(p.path)}">
    <dl class="meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${todos}
    <div class="detail-actions">
      ${g && !g.error ? `<button class="btn sm" data-action="graph">${icon('graph')}Branch graph</button>` : ''}
      <button class="btn sm" data-action="rescan">${icon('refresh')}Rescan this project</button>
      <button class="btn sm" data-action="hide">${icon('eyeOff')}Hide from list</button>
    </div>
  </div>`;
}

const HEAD = `<div class="row head"><span></span><span>Project</span><span class="col-branch">Branch</span><span class="col-status">Status</span><span class="col-commit">Last commit</span><span class="col-todo">TODOs</span><span></span></div>`;

function render() {
  const list = visible();
  state.view = list;
  if (!list.some((p) => p.path === state.selected)) state.selected = list[0]?.path ?? null;

  const el = $('#list');
  const scroll = el.scrollTop;
  if (list.length) {
    el.innerHTML = HEAD + list.map(rowHtml).join('');
  } else {
    el.innerHTML = emptyHtml();
  }
  el.scrollTop = scroll;

  // filter chips + counts
  const hidden = new Set(state.config.hidden);
  const all = state.projects.filter((p) => !hidden.has(p.path));
  document.querySelectorAll('#filters .chip').forEach((chip) => {
    const f = chip.dataset.filter;
    chip.classList.toggle('active', f === state.filter);
    chip.querySelector('b').textContent = all.filter(FILTERS[f]).length;
  });

  const todoTotal = all.reduce((n, p) => n + p.todoCount, 0);
  const parts = [`${all.length} project${all.length === 1 ? '' : 's'}`];
  if (list.length !== all.length) parts[0] = `${list.length} of ${all.length} projects`;
  parts.push(`${all.filter(FILTERS.dirty).length} uncommitted`, `${all.filter(unsynced).length} unpushed/behind`, `${todoTotal} TODOs`);
  parts.push(state.scanning ? 'scanning…' : state.lastScan ? `scanned ${ago(state.lastScan / 1000)}` : 'cached');
  parts.push(`editor: ${editorName()}`);
  $('#status').textContent = parts.join(' · ');
}

function emptyHtml() {
  if (!state.config.roots.length) {
    return `<div class="empty"><h2>No project folders yet</h2><p>Add the folder (or folders) where you keep your code. Dev Hub finds every git repo and project inside.</p><button class="btn primary" data-open-settings>Add a folder</button></div>`;
  }
  if (!state.projects.length) {
    return state.scanning
      ? `<div class="empty"><h2>Scanning…</h2><p>Looking for projects in ${state.config.roots.map((r) => esc(shortPath(r))).join(', ')}.</p></div>`
      : `<div class="empty"><h2>No projects found</h2><p>Nothing that looks like a project in ${state.config.roots.map((r) => esc(shortPath(r))).join(', ')}. Try a different folder or a deeper folder depth.</p><button class="btn" data-open-settings>Open settings</button></div>`;
  }
  return `<div class="empty"><h2>No matches</h2><p>No projects match ${state.query ? `“${esc(state.query)}”` : 'this filter'}.</p></div>`;
}

/* selection without a full re-render */
function select(path, scroll = true) {
  state.selected = path;
  document.querySelectorAll('.row.selected').forEach((r) => r.classList.remove('selected'));
  const row = [...document.querySelectorAll('.row[data-path]')].find((r) => r.dataset.path === path);
  if (row) {
    row.classList.add('selected');
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }
}
function move(delta) {
  if (!state.view.length) return;
  const i = state.view.findIndex((p) => p.path === state.selected);
  const next = Math.min(state.view.length - 1, Math.max(0, (i < 0 ? 0 : i + delta)));
  select(state.view[next].path);
}
function toggle(path) {
  if (state.expanded.has(path)) state.expanded.delete(path); else state.expanded.add(path);
  render();
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, error ? 6000 : 2500);
}

/* ---------- actions ---------- */
async function saveConfig() {
  await invoke('save_config', { config: state.config });
}

async function act(action, p, el) {
  try {
    switch (action) {
      case 'open':
        await invoke('open_in_editor', { path: p.path });
        toast(`Opening ${p.name} in ${editorName()}`);
        break;
      case 'todo': {
        const t = p.todos[Number(el.dataset.i)];
        await invoke('open_in_editor', { path: p.path, file: t.file, line: t.line });
        toast(`Opening ${t.file}:${t.line}`);
        break;
      }
      case 'graph': if (p.git && !p.git.error) openGraph(p); break;
      case 'term': await invoke('open_terminal', { path: p.path }); break;
      case 'folder': await invoke('open_folder', { path: p.path }); break;
      case 'web': { const u = webUrl(p.git?.remoteUrl); if (u) await invoke('open_url', { url: u }); break; }
      case 'expand': select(p.path, false); toggle(p.path); break;
      case 'pin': {
        const pins = state.config.pinned;
        state.config.pinned = isPinned(p) ? pins.filter((x) => x !== p.path) : [...pins, p.path];
        await saveConfig();
        render();
        break;
      }
      case 'hide':
        state.config.hidden = [...state.config.hidden, p.path];
        state.expanded.delete(p.path);
        await saveConfig();
        render();
        toast(`Hid ${p.name}. Unhide it in Settings.`);
        break;
      case 'rescan': {
        const fresh = await invoke('scan_project', { path: p.path });
        state.projects = state.projects.map((x) => (x.path === p.path ? fresh : x));
        render();
        toast(`Rescanned ${p.name}`);
        break;
      }
    }
  } catch (err) {
    toast(String(err), true);
  }
}

async function scan({ quiet = false } = {}) {
  if (state.scanning) return;
  state.scanning = true;
  $('#refresh').classList.add('spinning');
  $('#progress').classList.add('indeterminate');
  render();
  try {
    state.projects = await invoke('scan_projects');
    state.lastScan = Date.now();
    for (const path of [...state.expanded]) if (!byPath(path)) state.expanded.delete(path);
  } catch (err) {
    if (!quiet) toast(String(err), true);
  } finally {
    state.scanning = false;
    $('#refresh').classList.remove('spinning');
    const bar = $('#progress');
    bar.classList.remove('indeterminate');
    bar.firstElementChild.style.width = '100%';
    setTimeout(() => { bar.firstElementChild.style.width = '0'; }, 250);
    render();
  }
}

listen('scan-progress', (e) => {
  const [done, total] = e.payload;
  const bar = $('#progress');
  if (total > 0) {
    bar.classList.remove('indeterminate');
    bar.firstElementChild.style.width = `${Math.round((done / total) * 100)}%`;
  }
});

/* ---------- list events ---------- */
$('#list').addEventListener('click', (e) => {
  if (e.target.closest('[data-open-settings]')) { openSettings(); return; }
  const host = e.target.closest('[data-path]');
  if (!host) return;
  const p = byPath(host.dataset.path);
  if (!p) return;
  const btn = e.target.closest('[data-action]');
  if (btn) { act(btn.dataset.action, p, btn); return; }
  if (host.classList.contains('row')) {
    if (state.selected === p.path) toggle(p.path); else select(p.path, false);
  }
});
$('#list').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.row[data-path]');
  if (!row || e.target.closest('button')) return;
  const p = byPath(row.dataset.path);
  if (p) act('open', p);
});

/* ---------- toolbar ---------- */
const search = $('#search');
search.addEventListener('input', () => {
  state.query = search.value.trim();
  state.selected = null; // first match becomes selected → Enter opens it
  render();
  $('#list').scrollTop = 0;
});
$('#filters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.filter = chip.dataset.filter;
  store.set('filter', state.filter);
  render();
});
const sortSel = $('#sort');
sortSel.value = state.sort;
sortSel.addEventListener('change', () => { state.sort = sortSel.value; store.set('sort', state.sort); render(); });
$('#refresh').addEventListener('click', () => scan());
$('#settings-btn').addEventListener('click', () => openSettings());

/* ---------- keyboard ---------- */
document.addEventListener('keydown', (e) => {
  if ($('#settings').open || graphOpen()) return;
  const k = e.key;
  const inSearch = document.activeElement === search;
  const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName) && !inSearch;
  const mod = e.ctrlKey || e.metaKey;

  if ((mod && k.toLowerCase() === 'r') || k === 'F5') { e.preventDefault(); scan(); return; }
  if ((mod && k.toLowerCase() === 'k') || (k === '/' && !inSearch && !inField)) { e.preventDefault(); search.focus(); search.select(); return; }
  if (mod && k === ',') { e.preventDefault(); openSettings(); return; }
  if (inField || mod || e.altKey) return;

  const p = byPath(state.selected);
  if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); move(k === 'ArrowDown' ? 1 : -1); return; }
  if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); move(k === 'PageDown' ? 10 : -10); return; }
  if (k === 'Enter' && p) { e.preventDefault(); act('open', p); return; }
  if (k === 'Escape') {
    if (inSearch && search.value) { search.value = ''; search.dispatchEvent(new Event('input')); } else search.blur();
    return;
  }
  if (inSearch || !p) return;
  const keyActions = { b: 'graph', t: 'term', f: 'folder', p: 'pin', o: 'web', ' ': 'expand', ArrowRight: 'expand', ArrowLeft: 'expand' };
  const action = keyActions[k.length === 1 ? k.toLowerCase() : k];
  if (!action) return;
  if (k === 'ArrowRight' && state.expanded.has(p.path)) return;
  if (k === 'ArrowLeft' && !state.expanded.has(p.path)) return;
  e.preventDefault();
  act(action, p);
});

// Refresh git status when coming back to the window after a while.
window.addEventListener('focus', () => {
  if (Date.now() - state.lastScan > 120_000 && state.config?.roots.length) scan({ quiet: true });
});

/* ---------- settings ---------- */
const dlg = $('#settings');
let draft = null;

function openSettings() {
  draft = structuredClone(state.config);
  const preset = $('#editor-preset');
  preset.innerHTML = EDITORS.map(([c, n]) => `<option value="${esc(c)}">${esc(n)}</option>`).join('');
  const known = EDITORS.some(([c]) => c && c === draft.editor);
  preset.value = known ? draft.editor : '';
  $('#editor-custom').value = known ? '' : draft.editor;
  $('#editor-custom').hidden = known;
  $('#depth').value = draft.scanDepth;
  $('#scan-todos').checked = draft.scanTodos;
  $('#root-input').value = '';
  renderSettingsLists();
  checkEditor();
  dlg.showModal();
}

function renderSettingsLists() {
  $('#roots').innerHTML = draft.roots.map((r, i) =>
    `<li><span>${esc(r)}</span><button type="button" class="icon-btn" data-remove-root="${i}" title="Remove">${icon('x')}</button></li>`).join('');
  $('#hidden').innerHTML = draft.hidden.map((h, i) =>
    `<li><span>${esc(h)}</span><button type="button" class="btn sm" data-unhide="${i}">Unhide</button></li>`).join('');
  $('#hidden-section').hidden = !draft.hidden.length;
}

function addRoot(path) {
  path = (path || '').trim().replace(/^"|"$/g, '');
  if (!path) return;
  if (!draft.roots.some((r) => r.toLowerCase() === path.toLowerCase())) draft.roots.push(path);
  $('#root-input').value = '';
  renderSettingsLists();
}

let checkSeq = 0;
async function checkEditor() {
  const cmd = $('#editor-preset').value || $('#editor-custom').value.trim();
  const out = $('#editor-check');
  if (!cmd) { out.textContent = 'Enter the command you use to launch your editor.'; return; }
  const seq = ++checkSeq;
  const found = await invoke('check_editor', { editor: cmd }).catch(() => null);
  if (seq !== checkSeq) return;
  out.innerHTML = found ? `Found: <span class="mono">${esc(found)}</span>` : `<span style="color:var(--red)">“${esc(cmd)}” was not found on PATH.</span> Use the full path to the executable.`;
}

dlg.addEventListener('click', async (e) => {
  if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
  const rm = e.target.closest('[data-remove-root]');
  if (rm) { draft.roots.splice(Number(rm.dataset.removeRoot), 1); renderSettingsLists(); return; }
  const un = e.target.closest('[data-unhide]');
  if (un) { draft.hidden.splice(Number(un.dataset.unhide), 1); renderSettingsLists(); }
});
$('#root-add').addEventListener('click', () => addRoot($('#root-input').value));
$('#root-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRoot(e.target.value); } });
$('#root-browse').addEventListener('click', async () => {
  try {
    const picked = await invoke('plugin:dialog|open', { options: { directory: true, multiple: false, title: 'Add a project folder' } });
    if (picked) addRoot(Array.isArray(picked) ? picked[0] : picked);
  } catch (err) { toast(String(err), true); }
});
$('#editor-preset').addEventListener('change', (e) => {
  $('#editor-custom').hidden = !!e.target.value;
  if (!e.target.value) $('#editor-custom').focus();
  checkEditor();
});
$('#editor-custom').addEventListener('input', checkEditor);

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  addRoot($('#root-input').value); // keep a typed-but-not-added path
  draft.editor = $('#editor-preset').value || $('#editor-custom').value.trim() || 'code';
  draft.scanDepth = Math.min(6, Math.max(1, parseInt($('#depth').value, 10) || 3));
  draft.scanTodos = $('#scan-todos').checked;
  try {
    await invoke('save_config', { config: draft });
    state.config = draft;
    dlg.close();
    render();
    scan();
  } catch (err) {
    toast(String(err), true);
  }
});

/* ---------- start ---------- */
(async function init() {
  try {
    [state.config, state.projects, state.home] = await Promise.all([
      invoke('get_config'), invoke('load_cached'), invoke('home_dir'),
    ]);
  } catch (err) {
    toast(String(err), true);
    return;
  }
  render();
  if (!state.config.roots.length) openSettings();
  else scan();
})();

/* ---------- demo data when running outside Tauri ---------- */
function demoGraph(now) {
  const L = (name, current = false) => ({ name, kind: 'local', current });
  const R = (name) => ({ name, kind: 'remote', current: false });
  const T = (name) => ({ name, kind: 'tag', current: false });
  // Newest first, children before parents.
  const spec = [
    ['m9', ['m8', 'f3'], [L('main', true), R('origin/main')], 'Merge branch feature/export'],
    ['x2', ['x1'], [L('experiment/wasm')], 'Try compiling the core to wasm'],
    ['f3', ['f2'], [L('feature/export'), R('origin/feature/export')], 'Add parquet writer'],
    ['m8', ['m7'], [], 'Fix list scrolling on small windows'],
    ['f2', ['f1'], [], 'Export dialog'],
    ['x1', ['m6'], [], 'Spike: wasm build'],
    ['m7', ['m6', 'h1'], [T('v0.3.0')], 'Merge pull request #12 from fix/ci'],
    ['f1', ['m6'], [], 'Start export feature'],
    ['h1', ['m5'], [R('origin/fix/ci')], 'Cache cargo registry in CI'],
    ['m6', ['m5'], [], 'Bump dependencies'],
    ['m5', ['m4'], [], 'Settings dialog'],
    ['m4', ['m3'], [T('v0.2.0')], 'Release 0.2.0'],
    ['m3', ['m2'], [L('old/prototype')], 'TODO scanner'],
    ['m2', ['m1'], [], 'Git status per project'],
    ['m1', [], [], 'Initial commit'],
  ];
  const hash = (id) => (id + 'deadbeefcafe').padEnd(40, '0');
  const commits = spec.map(([id, parents, refs, subject], i) => ({
    hash: hash(id), parents: parents.map(hash), refs, subject,
    author: i % 3 ? 'dev' : 'collaborator', timestamp: now - (i * 7 + 2) * 3600,
  }));
  const B = (name, id, o = {}) => ({ name, remote: false, hash: hash(id), upstream: null, ahead: 0, behind: 0, gone: false, current: false,
    timestamp: commits.find((c) => c.hash === hash(id)).timestamp, subject: spec.find((s) => s[0] === id)[3], ...o });
  return {
    commits,
    head: hash('m9'),
    truncated: false,
    branches: [
      B('main', 'm9', { current: true, upstream: 'origin/main', ahead: 1 }),
      B('feature/export', 'f3', { upstream: 'origin/feature/export' }),
      B('experiment/wasm', 'x2'),
      B('old/prototype', 'm3', { upstream: 'origin/old/prototype', gone: true }),
      B('origin/main', 'm8', { remote: true }),
      B('origin/feature/export', 'f3', { remote: true }),
      B('origin/fix/ci', 'h1', { remote: true }),
    ],
  };
}

function demoInvoke(cmd, args) {
  const now = Date.now() / 1000;
  const commit = (subject, author, hoursAgo) => ({ hash: Math.random().toString(16).slice(2, 9), subject, author, timestamp: now - hoursAgo * 3600 });
  const git = (o) => ({ branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0, lastCommit: null, remoteUrl: null, error: null, ...o });
  const demo = demoInvoke.data ||= {
    config: { roots: ['C:\\Users\\dev\\projects'], editor: 'code', scanDepth: 3, scanTodos: true, hidden: [], pinned: ['C:\\Users\\dev\\projects\\tauri\\AeonDataStudio'] },
    projects: [
      { name: 'AeonDataStudio', path: 'C:\\Users\\dev\\projects\\tauri\\AeonDataStudio', kinds: ['rust', 'tauri'], modified: now, todoCount: 14,
        todos: [{ file: 'core/src/pipeline.rs', line: 118, kind: 'TODO', text: 'stream rows instead of collecting the whole batch' }, { file: 'src/app.rs', line: 42, kind: 'FIXME', text: 'dialog loses focus after export' }, { file: 'cli/src/main.rs', line: 9, kind: 'HACK', text: 'work around clap env parsing' }],
        git: git({ modified: 3, untracked: 1, ahead: 2, remoteUrl: 'git@github.com:dev/AeonDataStudio.git', lastCommit: commit('Add parquet export to the CLI', 'dev', 5) }) },
      { name: 'AeonDevHub', path: 'C:\\Users\\dev\\projects\\tauri\\AeonDevHub', kinds: ['tauri'], modified: now - 600, todoCount: 0, todos: [], git: null },
      { name: 'blog', path: 'C:\\Users\\dev\\projects\\web\\blog', kinds: ['node'], modified: now, todoCount: 3,
        todos: [{ file: 'src/pages/index.astro', line: 12, kind: 'TODO', text: 'pagination' }],
        git: git({ behind: 4, remoteUrl: 'https://github.com/dev/blog.git', lastCommit: commit('Post: notes on Rust error handling', 'dev', 30) }) },
      { name: 'dotfiles', path: 'C:\\Users\\dev\\projects\\dotfiles', kinds: [], modified: now, todoCount: 0, todos: [],
        git: git({ remoteUrl: 'git@github.com:dev/dotfiles.git', lastCommit: commit('nvim: switch to lazy.nvim', 'dev', 24 * 9) }) },
      { name: 'ml-sandbox', path: 'C:\\Users\\dev\\projects\\py\\ml-sandbox', kinds: ['python'], modified: now, todoCount: 27, todos: [],
        git: git({ upstream: null, staged: 2, modified: 5, untracked: 8, lastCommit: commit('wip', 'dev', 24 * 40) }) },
      { name: 'old-game-jam', path: 'C:\\Users\\dev\\projects\\games\\old-game-jam', kinds: ['c++'], modified: now, todoCount: 6, todos: [],
        git: git({ branch: 'feature/levels', lastCommit: commit('Level 3 boss', 'dev', 24 * 400), remoteUrl: 'git@gitlab.com:dev/jam.git' }) },
    ],
  };
  switch (cmd) {
    case 'get_config': return Promise.resolve(structuredClone(demo.config));
    case 'load_cached': case 'scan_projects': return new Promise((r) => setTimeout(() => r(structuredClone(demo.projects)), cmd === 'scan_projects' ? 600 : 0));
    case 'home_dir': return Promise.resolve('C:\\Users\\dev');
    case 'save_config': demo.config = structuredClone(args.config); return Promise.resolve();
    case 'check_editor': return Promise.resolve(args.editor === 'code' ? 'C:\\…\\Microsoft VS Code\\bin\\code.cmd' : null);
    case 'scan_project': return Promise.resolve(structuredClone(demo.projects.find((p) => p.path === args.path)));
    case 'git_graph': return new Promise((r) => setTimeout(() => r(demoGraph(now)), 150));
    default: return Promise.reject(`Demo mode: "${cmd}" only works in the desktop app.`);
  }
}
