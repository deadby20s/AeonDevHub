'use strict';
/* Branch graph view: every branch's history for one repo, drawn as lanes. Uses helpers from main.js. */

const ROW = 28;      // px per commit row
const LANE = 14;     // px between lanes
const GPAD = 12;     // px left of the first lane
const PAGE = 400;    // commits per load
const LANE_COLORS = ['#5b8def', '#e5534b', '#3fb950', '#d29922', '#a371f7', '#2fbccd', '#e0823d', '#db61a2', '#8b949e', '#6cb6ff'];

const gv = { project: null, data: null, layout: null, index: new Map(), selected: -1, limit: PAGE, seq: 0 };
const gvEl = (id) => document.getElementById(id);
const graphOpen = () => !gvEl('graph-view').hidden;

/**
 * Assigns each commit a lane (column) and computes the edges between rows.
 * Commits must be in topological order, newest first. Lanes keep their column
 * until their branch ends, so lines run straight down.
 */
function layoutGraph(commits) {
  const lanes = [];      // lanes[i] = hash of the commit that lane i is heading to, or null
  const laneColor = [];
  let nextColor = 0;
  const nodes = [];
  const edges = [];      // {x1, y1, x2, y2, color} in lane/row units
  // Edges leaving the previous row: {x: from lane, to: lane it continues in, hash, color}.
  // Several lanes may head to the same commit (a fork point); they all bend into it there.
  let pending = [];
  let width = 1;
  const freeLane = () => { const i = lanes.indexOf(null); return i < 0 ? lanes.length : i; };

  commits.forEach((c, row) => {
    let col = lanes.indexOf(c.hash);   // leftmost lane heading here, usually the mainline
    if (col < 0) {                     // branch tip: nothing above points here
      col = freeLane();
      lanes[col] = c.hash;
      laneColor[col] = nextColor++;
    }
    const color = laneColor[col];

    for (const e of pending) {
      edges.push({ x1: e.x, y1: row - 1, x2: e.hash === c.hash ? col : e.to, y2: row, color: e.color });
    }
    // Every lane that was heading here ends here.
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === c.hash) lanes[i] = null;
    nodes.push({ col, color, merge: c.parents.length > 1 });

    const started = new Set();   // lanes that start at this commit
    const joins = [];            // merge edges into a lane that already exists
    c.parents.forEach((p, k) => {
      if (k === 0) {             // the first parent always continues this commit's lane
        lanes[col] = p;
        laneColor[col] = color;
        started.add(col);
        return;
      }
      const existing = lanes.indexOf(p);
      if (existing >= 0) {
        joins.push({ x: col, to: existing, hash: p, color: laneColor[existing] });
        return;
      }
      const lane = freeLane();
      lanes[lane] = p;
      laneColor[lane] = nextColor++;
      started.add(lane);
    });

    pending = joins;
    lanes.forEach((hash, i) => {
      if (hash) pending.push({ x: started.has(i) ? col : i, to: i, hash, color: laneColor[i] });
    });
    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();
    width = Math.max(width, lanes.length, col + 1);
  });

  // History continues below the last loaded commit.
  const last = commits.length - 1;
  for (const e of pending) edges.push({ x1: e.x, y1: last, x2: e.to, y2: last + 0.6, color: e.color });
  return { nodes, edges, width };
}

const laneX = (col) => GPAD + col * LANE;
const rowY = (row) => row * ROW + ROW / 2;
const colorOf = (n) => LANE_COLORS[n % LANE_COLORS.length];

function graphSvg(layout, commits, head) {
  // One <path> per color keeps the DOM small even for thousands of edges.
  const byColor = new Map();
  for (const e of layout.edges) {
    const x1 = laneX(e.x1), y1 = rowY(e.y1), x2 = laneX(e.x2), y2 = rowY(e.y2);
    const d = x1 === x2
      ? `M${x1} ${y1}V${y2}`
      : `M${x1} ${y1}C${x1} ${y1 + ROW * 0.55} ${x2} ${y2 - ROW * 0.55} ${x2} ${y2}`;
    byColor.set(e.color, (byColor.get(e.color) || '') + d);
  }
  let out = '';
  for (const [color, d] of byColor) out += `<path d="${d}" stroke="${colorOf(color)}"/>`;
  layout.nodes.forEach((n, row) => {
    const cx = laneX(n.col), cy = rowY(row), col = colorOf(n.color);
    if (commits[row].hash === head) {
      out += `<circle class="head-ring" cx="${cx}" cy="${cy}" r="7" stroke="${col}"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="${col}" stroke="none"/>`;
    } else if (n.merge) {
      out += `<circle class="merge" cx="${cx}" cy="${cy}" r="4" stroke="${col}"/>`;
    } else {
      out += `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${col}"/>`;
    }
  });
  return out;
}

function refChips(c, color) {
  const locals = new Set(c.refs.filter((r) => r.kind === 'local').map((r) => r.name));
  // "origin/main" next to "main" on the same commit is folded into the local chip.
  const synced = new Map();
  for (const r of c.refs) {
    if (r.kind !== 'remote') continue;
    const slash = r.name.indexOf('/');
    const short = r.name.slice(slash + 1);
    if (locals.has(short)) synced.set(short, [...(synced.get(short) || []), r.name.slice(0, slash)]);
  }
  return c.refs.map((r) => {
    if (r.kind === 'remote') {
      const short = r.name.slice(r.name.indexOf('/') + 1);
      if (locals.has(short)) return '';
      return `<span class="ref remote" title="Remote branch ${esc(r.name)}">${icon('cloud')}${esc(r.name)}</span>`;
    }
    if (r.kind === 'tag') return `<span class="ref tag" title="Tag ${esc(r.name)}">${icon('tag')}${esc(r.name)}</span>`;
    if (r.kind === 'head') return `<span class="ref head" title="Detached HEAD">HEAD</span>`;
    const remotes = synced.get(r.name);
    const tip = `${r.current ? 'Checked-out branch' : 'Branch'} ${r.name}${remotes ? ` (same as ${remotes.map((x) => `${x}/${r.name}`).join(', ')})` : ''}`;
    return `<span class="ref${r.current ? ' current' : ''}" style="--c:${colorOf(color)}" title="${esc(tip)}">${icon('branch')}${esc(r.name)}${remotes ? `<span class="ref-remote">${icon('cloud')}</span>` : ''}</span>`;
  }).join('');
}

function renderGraph() {
  const { commits, head, truncated } = gv.data;
  const L = gv.layout;
  const graphW = GPAD * 2 + (L.width - 1) * LANE;
  const canvas = gvEl('gv-canvas');
  canvas.style.setProperty('--gw', `${graphW}px`);

  const svg = gvEl('gv-svg');
  svg.setAttribute('width', graphW);
  svg.setAttribute('height', commits.length * ROW);
  svg.innerHTML = graphSvg(L, commits, head);

  gvEl('gv-rows').innerHTML = commits.map((c, i) => `<div class="gv-row${i === gv.selected ? ' selected' : ''}" data-i="${i}">
      <div class="gv-msg">${refChips(c, L.nodes[i].color)}<span class="ellipsis" title="${esc(c.subject)}">${esc(c.subject)}</span></div>
      <span class="gv-author ellipsis">${esc(c.author)}</span>
      <span class="gv-date" title="${esc(new Date(c.timestamp * 1000).toLocaleString())}">${ago(c.timestamp)}</span>
      <span class="gv-hash mono">${c.hash.slice(0, 7)}</span>
    </div>`).join('')
    + (truncated ? `<div class="gv-more"><button class="btn sm" data-gv="more">Load ${PAGE} older commits</button></div>` : '');

  const locals = gv.data.branches.filter((b) => !b.remote).length;
  gvEl('gv-meta').textContent = `${locals} local · ${gv.data.branches.length - locals} remote branches · ${commits.length}${truncated ? '+' : ''} commits`;
}

function renderBranches() {
  const { branches } = gv.data;
  const item = (b) => {
    const loaded = gv.index.has(b.hash);
    const track = b.gone ? 'upstream deleted' : b.upstream ? `tracks ${b.upstream}` : b.remote ? '' : 'not pushed';
    return `<button class="gv-branch${b.current ? ' current' : ''}${loaded ? '' : ' older'}" data-hash="${esc(b.hash)}"
        title="${esc(`${b.name}${track ? ` — ${track}` : ''}\n${b.subject}\n${ago(b.timestamp)}${loaded ? '' : '\n(older than the loaded commits)'}`)}">
      <span class="ellipsis">${esc(b.name)}</span>
      ${b.ahead ? `<span class="ab up" title="${b.ahead} to push">↑${b.ahead}</span>` : ''}
      ${b.behind ? `<span class="ab down" title="${b.behind} to pull">↓${b.behind}</span>` : ''}
      ${b.gone ? '<span class="gone">gone</span>' : ''}
      <span class="faint gv-when">${ago(b.timestamp)}</span>
    </button>`;
  };
  const section = (title, list) => list.length
    ? `<h3>${title} <span class="faint">${list.length}</span></h3>${list.map(item).join('')}` : '';
  gvEl('gv-side').innerHTML = section('Local', branches.filter((b) => !b.remote))
    + section('Remote', branches.filter((b) => b.remote))
    || '<p class="help" style="padding:0 12px">No branches yet.</p>';
}

function renderFoot() {
  const foot = gvEl('gv-foot');
  const c = gv.data?.commits[gv.selected];
  if (!c) { foot.innerHTML = '<span class="faint">Select a commit to see its details.</span>'; return; }
  const parents = c.parents.map((p) => gv.index.has(p)
    ? `<button class="link mono" data-gv="jump" data-hash="${esc(p)}">${p.slice(0, 7)}</button>`
    : `<span class="mono faint">${p.slice(0, 7)}</span>`).join(' ');
  foot.innerHTML = `<div class="gv-foot-main">
      <span class="gv-subject selectable">${esc(c.subject)}</span>
      <span class="faint">${esc(c.author)} · ${esc(new Date(c.timestamp * 1000).toLocaleString())}</span>
    </div>
    <div class="gv-foot-meta">
      <button class="link mono" data-gv="copy" title="Copy full hash">${c.hash.slice(0, 12)} ${icon('copy')}</button>
      ${c.parents.length ? `<span class="faint">${c.parents.length > 1 ? 'parents' : 'parent'}</span> ${parents}` : '<span class="faint">root commit</span>'}
    </div>`;
}

function selectCommit(i, scroll = 'nearest') {
  if (!gv.data || i < 0 || i >= gv.data.commits.length) return;
  gv.selected = i;
  const rows = gvEl('gv-rows');
  rows.querySelector('.gv-row.selected')?.classList.remove('selected');
  const row = rows.children[i];
  row?.classList.add('selected');
  if (row && scroll) row.scrollIntoView({ block: scroll });
  renderFoot();
}

function jumpTo(hash) {
  const i = gv.index.get(hash);
  if (i == null) { toast(`That commit is older than the ${gv.data.commits.length} loaded. Load older commits first.`); return; }
  selectCommit(i, 'center');
}

async function openGraph(p, limit = PAGE) {
  const seq = ++gv.seq;
  const reopening = gv.project?.path === p.path && gv.data;
  const keep = reopening ? gv.data.commits[gv.selected]?.hash : null;
  const scrollTop = reopening ? gvEl('gv-scroll').scrollTop : 0;
  gv.project = p;
  gv.limit = limit;
  gvEl('graph-view').hidden = false;
  gvEl('gv-title').textContent = p.name;
  gvEl('gv-path').textContent = shortPath(p.path);
  if (!reopening) {
    gv.data = null;
    gvEl('gv-svg').innerHTML = '';
    gvEl('gv-side').innerHTML = '';
    gvEl('gv-meta').textContent = '';
    gvEl('gv-foot').innerHTML = '';
    gvEl('gv-rows').innerHTML = '<div class="gv-msgbox">Loading history…</div>';
  }
  gvEl('gv-reload').classList.add('spinning');
  try {
    const data = await invoke('git_graph', { path: p.path, limit });
    if (seq !== gv.seq) return;
    gv.data = data;
    gv.layout = layoutGraph(data.commits);
    gv.index = new Map(data.commits.map((c, i) => [c.hash, i]));
    if (!data.commits.length) {
      gvEl('gv-rows').innerHTML = '<div class="gv-msgbox">No commits yet.</div>';
      gvEl('gv-svg').innerHTML = '';
      renderBranches();
      renderFoot();
      return;
    }
    gv.selected = gv.index.get(keep ?? data.head) ?? 0;
    renderGraph();
    renderBranches();
    renderFoot();
    if (reopening) gvEl('gv-scroll').scrollTop = scrollTop;
    else selectCommit(gv.selected, 'center');
  } catch (err) {
    if (seq !== gv.seq) return;
    gvEl('gv-rows').innerHTML = `<div class="gv-msgbox error">${esc(err)}</div>`;
  } finally {
    if (seq === gv.seq) gvEl('gv-reload').classList.remove('spinning');
  }
}

function closeGraph() {
  gv.seq++;
  gvEl('graph-view').hidden = true;
  const path = gv.project?.path;
  gv.project = null;
  gv.data = null;
  if (path) select(path);
}

/* ---------- events ---------- */
gvEl('gv-rows').addEventListener('click', (e) => {
  const more = e.target.closest('[data-gv="more"]');
  if (more) { openGraph(gv.project, gv.limit + PAGE); return; }
  const row = e.target.closest('.gv-row');
  if (row) selectCommit(Number(row.dataset.i), null);
});
gvEl('gv-side').addEventListener('click', (e) => {
  const b = e.target.closest('.gv-branch');
  if (b) jumpTo(b.dataset.hash);
});
gvEl('gv-foot').addEventListener('click', async (e) => {
  const jump = e.target.closest('[data-gv="jump"]');
  if (jump) { jumpTo(jump.dataset.hash); return; }
  if (e.target.closest('[data-gv="copy"]')) {
    const c = gv.data?.commits[gv.selected];
    try { await navigator.clipboard.writeText(c.hash); toast('Copied commit hash'); } catch { toast(c.hash); }
  }
});
gvEl('gv-close').addEventListener('click', closeGraph);
gvEl('gv-reload').addEventListener('click', () => gv.project && openGraph(gv.project, gv.limit));
gvEl('gv-open').addEventListener('click', () => gv.project && act('open', gv.project));
gvEl('gv-cleanup').addEventListener('click', () => gv.project && openCleanup(gv.project));
gvEl('gv-term').addEventListener('click', () => gv.project && act('term', gv.project));

document.addEventListener('keydown', (e) => {
  // defaultPrevented: the list's handler already used this key (e.g. the B that opened the graph).
  if (!graphOpen() || e.defaultPrevented || document.querySelector('dialog[open]')) return;
  const k = e.key;
  const mod = e.ctrlKey || e.metaKey;
  if (k === 'Escape' || (!mod && k.toLowerCase() === 'b')) { e.preventDefault(); closeGraph(); return; }
  if ((mod && k.toLowerCase() === 'r') || k === 'F5') { e.preventDefault(); openGraph(gv.project, gv.limit); return; }
  if (!gv.data?.commits.length) return;
  const n = gv.data.commits.length;
  const steps = { ArrowDown: 1, ArrowUp: -1, PageDown: 15, PageUp: -15, Home: -n, End: n };
  if (k in steps) {
    e.preventDefault();
    selectCommit(Math.min(n - 1, Math.max(0, gv.selected + steps[k])));
    return;
  }
  // Jump to a parent (first parent with →, or the merged-in branch with Shift+→).
  if (k === 'ArrowRight' || k === 'ArrowLeft') {
    const c = gv.data.commits[gv.selected];
    const p = k === 'ArrowRight' ? c.parents[e.shiftKey ? 1 : 0] : null;
    if (p) { e.preventDefault(); jumpTo(p); }
  }
});
