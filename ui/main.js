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
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 11h6M9 15h6M9 7h3"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pr: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10M18 17V9a3 3 0 0 0-3-3h-4M13 3l-3 3 3 3"/>',
  diff: '<path d="M12 3v8M8 7h8M8 17h8M5 3h14v18H5z"/>',
  broom: '<path d="M14 4l6 6M17 7l-7 7M10 14l-6 6M7 11l6 6-3 3H4v-6z"/>',
  warn: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
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
  fetching: false,
  gh: {},               // path → GitHub info (PRs, CI)
  ghAvailable: false,
  ghLast: 0,
  scripts: new Map(),   // path → detected scripts (loaded when details open)
};
const isGithub = (p) => (webUrl(p.git?.remoteUrl) || '').startsWith('https://github.com/');
const noteOf = (p) => state.config.notes?.[p.path] || '';
const openedAt = (p) => state.config.recent?.[p.path] || 0;
const overlayOpen = () => !!document.querySelector('.overlay:not([hidden]), dialog[open]');
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
      const hay = [p.name, shortPath(p.path), p.git?.branch, p.git?.lastCommit?.subject, noteOf(p), ...p.kinds].join(' ').toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }
  const cmp = {
    recent: (a, b) => activity(b) - activity(a),
    opened: (a, b) => openedAt(b) - openedAt(a) || activity(b) - activity(a),
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
  return `<button class="badge amber" data-action="changes" title="${parts.join(', ')} — click to see the changes (C)">${n} changed</button>`;
}

const CI_LABEL = { success: 'passed', failure: 'failed', cancelled: 'cancelled', skipped: 'skipped', timed_out: 'timed out', action_required: 'needs action' };
function ciState(ci) {
  if (!ci) return null;
  if (ci.status !== 'completed') return { cls: 'running', label: 'running' };
  const bad = ['failure', 'timed_out', 'startup_failure'].includes(ci.conclusion);
  return { cls: ci.conclusion === 'success' ? 'ok' : bad ? 'bad' : 'neutral', label: CI_LABEL[ci.conclusion] || ci.conclusion || 'done' };
}
function ciDot(p) {
  const ci = state.gh[p.path]?.ci;
  const s = ciState(ci);
  if (!s || (ci.branch && p.git?.branch && ci.branch !== p.git.branch)) return '';
  return `<span class="ci ${s.cls}" title="${esc(`CI ${s.label}: ${ci.name} on ${ci.branch}`)}"></span>`;
}
function prChip(p) {
  const info = state.gh[p.path];
  if (!info?.prs?.length) return '';
  const review = info.prs.filter((x) => x.reviewRequested).length;
  const head = `${info.prs.length} open PR${info.prs.length === 1 ? '' : 's'}${review ? `, ${review} waiting for your review` : ''}`;
  const tip = [head, ...info.prs.map((x) => `#${x.number} ${x.title}${x.reviewRequested ? ' (your review)' : ''}`)].join('\n');
  return `<span class="pr-chip${review ? ' review' : ''}" title="${esc(tip)}">${icon('pr')}${info.prs.length}</span>`;
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
      + ciDot(p)
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
      <div class="name"><span class="ellipsis">${esc(p.name)}</span>${p.kinds.map((k) => `<span class="kind">${esc(k)}</span>`).join('')}${prChip(p)}</div>
      ${noteOf(p)
        ? `<div class="note-line ellipsis" title="${esc(noteOf(p))}">${icon('note')}${esc(noteOf(p).split('\n')[0])}</div>`
        : `<div class="path ellipsis" title="${esc(p.path)}">${esc(shortPath(p.path))}</div>`}
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
  if (openedAt(p)) rows.push(['Last opened', `<span title="${esc(new Date(openedAt(p) * 1000).toLocaleString())}">${ago(openedAt(p))} from Dev Hub</span>`]);
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
  const git = g && !g.error;
  return `<div class="details" data-path="${esc(p.path)}">
    <div class="details-grid">
      <dl class="meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <label class="note-box">
        <span class="sub-head">${icon('note')}Note</span>
        <textarea data-note placeholder="Where you left off, what's next…" spellcheck="true">${esc(noteOf(p))}</textarea>
      </label>
    </div>
    ${scriptsHtml(p)}
    ${githubHtml(p)}
    ${todos}
    <div class="detail-actions">
      ${git ? `<button class="btn sm" data-action="graph">${icon('graph')}Branch graph</button>` : ''}
      ${git ? `<button class="btn sm" data-action="changes">${icon('diff')}Changes</button>` : ''}
      ${git ? `<button class="btn sm" data-action="cleanup">${icon('broom')}Clean up branches</button>` : ''}
      ${git && g.remoteUrl ? `<button class="btn sm" data-action="fetch-one">${icon('download')}Fetch</button>` : ''}
      <button class="btn sm" data-action="rescan">${icon('refresh')}Rescan</button>
      <button class="btn sm" data-action="hide">${icon('eyeOff')}Hide from list</button>
    </div>
  </div>`;
}

function scriptsHtml(p) {
  const list = state.scripts.get(p.path);
  if (list === undefined) return `<div class="scripts"><span class="sub-head">${icon('play')}Scripts</span><span class="faint">Looking for scripts…</span></div>`;
  if (!list.length) return '';
  const groups = new Map();
  list.forEach((s, i) => groups.set(s.group, [...(groups.get(s.group) || []), [s, i]]));
  return `<div class="scripts"><span class="sub-head">${icon('play')}Scripts <span class="faint">· opens in a terminal</span></span>
    ${[...groups].map(([group, items]) => `<div class="script-group"><span class="script-runner">${esc(group)}</span>${items.map(([s, i]) =>
      `<button class="script" data-action="script" data-i="${i}" title="${esc(`${s.command}${s.cwd ? ` (in ${s.cwd})` : ''}`)}">${icon('play')}${esc(s.name)}</button>`).join('')}</div>`).join('')}
  </div>`;
}

function githubHtml(p) {
  if (!state.config.github || !isGithub(p)) return '';
  const info = state.gh[p.path];
  const refresh = `<button class="link" data-action="gh-refresh" title="Refresh from GitHub">${icon('refresh')}</button>`;
  if (!state.ghAvailable) return `<div class="gh"><span class="sub-head">${icon('pr')}GitHub</span><span class="faint">Install the GitHub CLI (gh) and run <span class="mono">gh auth login</span> to see PRs and CI here.</span></div>`;
  if (!info) return `<div class="gh"><span class="sub-head">${icon('pr')}GitHub ${refresh}</span><span class="faint">Loading…</span></div>`;
  if (info.error) return `<div class="gh"><span class="sub-head">${icon('pr')}GitHub ${refresh}</span><span class="faint selectable">${esc(info.error)}</span></div>`;
  const s = ciState(info.ci);
  const ci = s
    ? `<button class="gh-ci" data-action="url" data-url="${esc(info.ci.url)}"><span class="ci ${s.cls}"></span>CI ${esc(s.label)} <span class="faint">· ${esc(info.ci.name)} on ${esc(info.ci.branch)} · ${ago(Date.parse(info.ci.createdAt) / 1000)}</span></button>`
    : '<span class="faint">No CI runs</span>';
  const REVIEW = { APPROVED: ['ok', 'approved'], CHANGES_REQUESTED: ['bad', 'changes requested'], REVIEW_REQUIRED: ['neutral', 'review required'] };
  const prs = info.prs.length
    ? info.prs.map((x) => {
      const [cls, label] = REVIEW[x.review] || [];
      return `<button class="gh-pr" data-action="url" data-url="${esc(x.url)}" title="${esc(x.url)}">
          <span class="mono faint">#${x.number}</span><span class="ellipsis">${esc(x.title)}</span>
          ${x.draft ? '<span class="tag-mini">draft</span>' : ''}
          ${x.reviewRequested ? '<span class="tag-mini accent">your review</span>' : ''}
          ${label ? `<span class="tag-mini ${cls}">${label}</span>` : ''}
          <span class="faint nowrap">${esc(x.author)} · ${esc(x.branch)}</span></button>`;
    }).join('')
    : '<span class="faint">No open pull requests</span>';
  return `<div class="gh"><span class="sub-head">${icon('pr')}GitHub ${refresh}<span class="faint">· updated ${ago(info.fetchedAt)}</span></span>
    <div class="gh-body">${ci}<div class="gh-prs">${prs}</div></div></div>`;
}

const HEAD = `<div class="row head"><span></span><span>Project</span><span class="col-branch">Branch</span><span class="col-status">Status</span><span class="col-commit">Last commit</span><span class="col-todo">TODOs</span><span></span></div>`;

/** Re-render unless the user is typing a note (that would throw away their cursor). */
let renderDeferred = false;
function safeRender() {
  if (document.activeElement?.matches?.('[data-note]')) { renderDeferred = true; return; }
  render();
}

function render() {
  renderDeferred = false;
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
  loadScriptsFor(list.filter((p) => state.expanded.has(p.path)));

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
  parts.push(state.fetching ? 'fetching…' : state.scanning ? 'scanning…' : state.lastScan ? `scanned ${ago(state.lastScan / 1000)}` : 'cached');
  if (state.config.autoRefresh) parts.push('auto-refresh on');
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
        markOpened(p);
        toast(`Opening ${p.name} in ${editorName()}`);
        break;
      case 'todo': {
        const t = p.todos[Number(el.dataset.i)];
        await invoke('open_in_editor', { path: p.path, file: t.file, line: t.line });
        markOpened(p);
        toast(`Opening ${t.file}:${t.line}`);
        break;
      }
      case 'graph': if (p.git && !p.git.error) openGraph(p); break;
      case 'changes': if (p.git && !p.git.error) openChanges(p); break;
      case 'cleanup': if (p.git && !p.git.error) openCleanup(p); break;
      case 'term':
        await invoke('open_terminal', { path: p.path });
        markOpened(p);
        break;
      case 'script': {
        const s = state.scripts.get(p.path)?.[Number(el.dataset.i)];
        if (!s) break;
        await invoke('run_script', { path: p.path, id: s.id });
        markOpened(p);
        toast(`Running ${s.command}`);
        break;
      }
      case 'fetch-one':
        toast(`Fetching ${p.name}…`);
        await fetchRepos([p]);
        break;
      case 'gh-refresh': await refreshGithub([p], { force: true }); break;
      case 'url': if (el.dataset.url) await invoke('open_url', { url: el.dataset.url }); break;
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

function markOpened(p) {
  state.config.recent = { ...(state.config.recent || {}), [p.path]: Math.floor(Date.now() / 1000) };
  if (state.sort === 'opened') safeRender();
}

function replaceProject(fresh) {
  if (!fresh || !byPath(fresh.path)) return;
  state.projects = state.projects.map((x) => (x.path === fresh.path ? fresh : x));
  state.scripts.delete(fresh.path); // package.json etc. may have changed
}

/* scripts are detected per project when its details open */
const scriptsLoading = new Set();
function loadScriptsFor(projects) {
  for (const p of projects) {
    if (state.scripts.has(p.path) || scriptsLoading.has(p.path)) continue;
    scriptsLoading.add(p.path);
    invoke('project_scripts', { path: p.path })
      .then((list) => state.scripts.set(p.path, list))
      .catch(() => state.scripts.set(p.path, []))
      .finally(() => { scriptsLoading.delete(p.path); safeRender(); });
  }
}

/* ---------- notes ---------- */
let noteTimer;
$('#list').addEventListener('input', (e) => {
  const ta = e.target.closest('[data-note]');
  if (!ta) return;
  const path = ta.closest('[data-path]').dataset.path;
  const notes = { ...(state.config.notes || {}) };
  const text = ta.value.trim() ? ta.value : '';
  if (text) notes[path] = text; else delete notes[path];
  state.config.notes = notes;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => saveConfig().catch((err) => toast(String(err), true)), 500);
});
$('#list').addEventListener('focusout', (e) => {
  if (e.target.matches?.('[data-note]') && renderDeferred) setTimeout(safeRender, 0);
});

/* ---------- fetch ---------- */
async function fetchRepos(projects) {
  const repos = projects.filter((p) => p.git && !p.git.error && p.git.remoteUrl);
  if (!repos.length || state.fetching) return;
  state.fetching = true;
  $('#fetch-all').classList.add('spinning');
  $('#progress').classList.add('indeterminate');
  safeRender();
  try {
    const results = await invoke('fetch_all', { paths: repos.map((p) => p.path) });
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      const name = (path) => byPath(path)?.name || path;
      toast(`Fetched ${results.length - failed.length} of ${results.length}. Failed: ${failed.map((f) => `${name(f.path)} (${(f.error || '').split('\n')[0]})`).join('; ')}`, true);
    } else {
      toast(`Fetched ${results.length} repo${results.length === 1 ? '' : 's'}`);
    }
  } catch (err) {
    toast(String(err), true);
  } finally {
    state.fetching = false;
    $('#fetch-all').classList.remove('spinning');
  }
  if (repos.length === 1) {
    replaceProject(await invoke('scan_project', { path: repos[0].path }).catch(() => null));
    safeRender();
  } else {
    await scan({ quiet: true });
  }
  refreshGithub(repos, { force: true });
}
listen('fetch-progress', (e) => {
  const [done, total] = e.payload;
  const bar = $('#progress');
  bar.classList.remove('indeterminate');
  bar.firstElementChild.style.width = `${Math.round((done / total) * 100)}%`;
});

/* ---------- GitHub ---------- */
let ghBusy = false;
async function refreshGithub(projects, { force = false } = {}) {
  if (!state.config.github || !state.ghAvailable || ghBusy) return;
  if (!force && Date.now() - state.ghLast < 10 * 60_000) return;
  const repos = projects.filter((p) => isGithub(p));
  if (!repos.length) return;
  ghBusy = true;
  try {
    const fresh = await invoke('github_info', { repos: repos.map((p) => ({ path: p.path, branch: p.git?.branch && p.git.branch !== '(detached)' ? p.git.branch : null })) });
    state.gh = { ...state.gh, ...fresh };
    if (repos.length > 1 || !force) state.ghLast = Date.now();
    safeRender();
  } catch (err) {
    if (force) toast(String(err), true);
  } finally {
    ghBusy = false;
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
    safeRender();
  }
  refreshGithub(state.projects);
}

// The file watcher rescanned one project.
listen('project-updated', (e) => {
  const fresh = e.payload;
  if (!byPath(fresh.path)) return;
  replaceProject(fresh);
  safeRender();
  if (typeof changesProjectUpdated === 'function') changesProjectUpdated(fresh);
});
// The global hotkey or a second launch brought the window up.
listen('focus-search', () => {
  if (overlayOpen()) return;
  search.focus();
  search.select();
});
listen('tray-action', (e) => {
  if (e.payload === 'rescan') scan();
  if (e.payload === 'fetch') fetchRepos(state.projects);
});

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
$('#fetch-all').addEventListener('click', () => fetchRepos(state.projects.filter((p) => !state.config.hidden.includes(p.path))));
$('#activity-btn').addEventListener('click', () => openActivity());
$('#settings-btn').addEventListener('click', () => openSettings());

/* ---------- keyboard ---------- */
document.addEventListener('keydown', (e) => {
  if (overlayOpen()) return;
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
  if (inSearch) return;
  if (k.toLowerCase() === 'a' && !e.shiftKey) { e.preventDefault(); openActivity(); return; }
  if (k === 'F' && e.shiftKey) { e.preventDefault(); $('#fetch-all').click(); return; }
  if (!p) return;
  if (k.toLowerCase() === 'n') { // jump to the note
    e.preventDefault();
    if (!state.expanded.has(p.path)) toggle(p.path);
    document.querySelector(`.details[data-path="${CSS.escape(p.path)}"] [data-note]`)?.focus();
    return;
  }
  const keyActions = { b: 'graph', c: 'changes', t: 'term', f: 'folder', p: 'pin', o: 'web', ' ': 'expand', ArrowRight: 'expand', ArrowLeft: 'expand' };
  const action = keyActions[k.length === 1 ? k.toLowerCase() : k];
  if (!action) return;
  if (k === 'ArrowRight' && state.expanded.has(p.path)) return;
  if (k === 'ArrowLeft' && !state.expanded.has(p.path)) return;
  e.preventDefault();
  act(action, p);
});

// Refresh git status when coming back to the window after a while
// (rarely when the file watcher is keeping things current anyway).
window.addEventListener('focus', () => {
  const every = state.config?.autoRefresh ? 15 * 60_000 : 2 * 60_000;
  if (Date.now() - state.lastScan > every && state.config?.roots.length) scan({ quiet: true });
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
  $('#auto-refresh').checked = draft.autoRefresh;
  $('#gh-enabled').checked = draft.github;
  $('#close-to-tray').checked = draft.closeToTray;
  $('#hotkey').value = draft.hotkey;
  $('#gh-status').textContent = state.ghAvailable ? '' : 'GitHub CLI (gh) not found.';
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

// Record a shortcut by pressing it.
$('#hotkey').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') return;
  e.preventDefault();
  if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey) { e.target.value = ''; return; }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
  const code = e.code;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3)
    : /^Digit\d$/.test(code) ? code.slice(5)
      : /^F\d{1,2}$/.test(code) || ['Space', 'Enter', 'Backquote', 'Minus', 'Equal', 'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'BracketLeft', 'BracketRight', 'Backslash', 'Home', 'End', 'PageUp', 'PageDown', 'Insert'].includes(code) ? code
        : null;
  if (!key) return;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  if (!mods.length && !/^F\d/.test(key)) { $('#hotkey-help').textContent = 'Use at least one of Ctrl, Alt, Shift or Win.'; return; }
  $('#hotkey-help').textContent = 'Shows or hides Dev Hub from anywhere. Backspace clears it.';
  e.target.value = [...mods, key].join('+');
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  addRoot($('#root-input').value); // keep a typed-but-not-added path
  draft.editor = $('#editor-preset').value || $('#editor-custom').value.trim() || 'code';
  draft.scanDepth = Math.min(6, Math.max(1, parseInt($('#depth').value, 10) || 3));
  draft.scanTodos = $('#scan-todos').checked;
  draft.autoRefresh = $('#auto-refresh').checked;
  draft.github = $('#gh-enabled').checked;
  draft.closeToTray = $('#close-to-tray').checked;
  draft.hotkey = $('#hotkey').value.trim();
  // Keep notes/recents written since the dialog opened.
  draft.notes = state.config.notes;
  draft.recent = state.config.recent;
  try {
    await invoke('save_config', { config: draft }).catch((err) => {
      if (String(err).startsWith('Settings saved')) toast(String(err), true); else throw err;
    });
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
    [state.config, state.projects, state.home, state.ghAvailable, state.gh] = await Promise.all([
      invoke('get_config'), invoke('load_cached'), invoke('home_dir'),
      invoke('github_available').catch(() => false), invoke('github_cached').catch(() => ({})),
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
    config: { roots: ['C:\\Users\\dev\\projects'], editor: 'code', scanDepth: 3, scanTodos: true, hidden: [], pinned: ['C:\\Users\\dev\\projects\\tauri\\AeonDataStudio'],
      notes: { 'C:\\Users\\dev\\projects\\py\\ml-sandbox': 'Left off tuning the learning-rate schedule.\nNext: try cosine warmup.' },
      recent: {}, hotkey: 'Ctrl+Alt+Space', closeToTray: true, autoRefresh: true, github: true },
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
    case 'github_available': return Promise.resolve(true);
    case 'github_cached': return Promise.resolve({});
    case 'github_info': return Promise.resolve(Object.fromEntries(args.repos.map(({ path }) => [path, {
      fetchedAt: now, error: null,
      ci: { name: 'CI', status: 'completed', conclusion: path.includes('blog') ? 'failure' : 'success', url: 'https://github.com/dev/x/actions/runs/1', branch: 'main', createdAt: new Date((now - 7200) * 1000).toISOString() },
      prs: path.includes('AeonDataStudio') ? [
        { number: 16, title: 'Streaming parquet export', url: 'https://github.com/dev/AeonDataStudio/pull/16', draft: false, author: 'collaborator', branch: 'feature/export', review: 'REVIEW_REQUIRED', reviewRequested: true, mine: false },
        { number: 15, title: 'WIP: wasm core', url: 'https://github.com/dev/AeonDataStudio/pull/15', draft: true, author: 'dev', branch: 'experiment/wasm', review: '', reviewRequested: false, mine: true },
      ] : [],
    }])));
    case 'fetch_all': return new Promise((r) => setTimeout(() => r(args.paths.map((path) => ({ path, ok: !path.includes('jam'), error: path.includes('jam') ? 'fatal: could not read Username for https://gitlab.com' : null }))), 700));
    case 'project_scripts': return Promise.resolve(args.path.includes('blog')
      ? ['dev', 'build', 'preview', 'lint'].map((n) => ({ id: n, group: 'pnpm', name: n, command: `pnpm ${n}`, cwd: '' }))
      : args.path.includes('AeonDataStudio') ? [...['build', 'run', 'test', 'check', 'clippy'].map((n) => ({ id: n, group: 'cargo', name: n, command: `cargo ${n}`, cwd: '' })), { id: 'td', group: 'tauri', name: 'dev', command: 'cargo tauri dev', cwd: 'src-tauri' }] : []);
    case 'stale_branches': return new Promise((r) => setTimeout(() => r({ base: 'main', branches: [
      { name: 'fix/ci', merged: true, gone: true, upstream: 'origin/fix/ci', timestamp: now - 86400 * 3, subject: 'Cache cargo registry in CI' },
      { name: 'old/prototype', merged: false, gone: true, upstream: 'origin/old/prototype', timestamp: now - 86400 * 40, subject: 'TODO scanner' },
      { name: 'release/0.2.0', merged: true, gone: false, upstream: null, timestamp: now - 86400 * 60, subject: 'Release 0.2.0' },
    ] }), 200));
    case 'delete_branches': return Promise.resolve(args.names.map((name) => ({ name, ok: true, error: null })));
    case 'changed_files': return Promise.resolve([
      { path: 'src/export/parquet.rs', orig: null, x: 'M', y: 'M' },
      { path: 'src/app.rs', orig: null, x: ' ', y: 'M' },
      { path: 'src/export/writer.rs', orig: 'src/writer.rs', x: 'R', y: ' ' },
      { path: 'docs/export.md', orig: null, x: '?', y: '?' },
    ]);
    case 'file_diff': return Promise.resolve({ binary: false, truncated: false, text: args.file.endsWith('.md')
      ? 'new file\n@@ -0,0 +1,3 @@\n+# Export\n+\n+Dev Hub can export to parquet.\n'
      : 'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -40,7 +40,9 @@ impl Exporter {\n     pub fn write(&mut self, rows: &[Row]) -> Result<()> {\n-        let batch = self.collect(rows)?;\n-        self.writer.write(&batch)?;\n+        for chunk in rows.chunks(self.batch_size) {\n+            let batch = self.collect(chunk)?;\n+            self.writer.write(&batch)?;\n+        }\n         self.rows += rows.len();\n         Ok(())\n     }\n' });
    case 'activity': return Promise.resolve(args.paths.map((path, i) => {
      const commits = [];
      let seed = i * 7919 + 13;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const busy = [0.55, 0.25, 0.12, 0.04, 0.08][i % 5];
      for (let d = 0; d < 365; d++) {
        if (rnd() < busy * (d < 120 ? 1.3 : 0.7)) {
          const n = 1 + Math.floor(rnd() * 5);
          for (let k = 0; k < n; k++) commits.push(Math.floor(now - d * 86400 - rnd() * 40000));
        }
      }
      return { path, commits, email: 'dev@users.noreply.github.com' };
    }));
    case 'open_in_editor': case 'open_terminal': case 'open_folder': case 'open_url': case 'run_script': return Promise.resolve();
    default: return Promise.reject(`Demo mode: "${cmd}" only works in the desktop app.`);
  }
}
