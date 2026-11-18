'use strict';
/* Changes view: uncommitted files of one repo with a diff of the selected file. Read-only. */

const cv = { project: null, items: [], sel: -1, seq: 0, diffSeq: 0, firstLine: null };
const cvEl = (id) => document.getElementById(id);
const changesOpen = () => !cvEl('changes-view').hidden;

const STATUS = {
  M: ['modified', 'm'], A: ['added', 'a'], D: ['deleted', 'd'], R: ['renamed', 'r'], C: ['copied', 'r'],
  T: ['type changed', 'm'], U: ['conflict', 'u'], '?': ['untracked', 'a'],
};

/** Turns `git status` entries into list items: one per side (staged / unstaged) that changed. */
function changeItems(files) {
  const conflicts = [], staged = [], unstaged = [], untracked = [];
  for (const f of files) {
    const conflict = f.x === 'U' || f.y === 'U' || (f.x === 'A' && f.y === 'A') || (f.x === 'D' && f.y === 'D');
    if (conflict) conflicts.push({ f, staged: false, code: 'U' });
    else if (f.x === '?') untracked.push({ f, staged: false, code: '?' });
    else {
      if (f.x !== ' ') staged.push({ f, staged: true, code: f.x });
      if (f.y !== ' ') unstaged.push({ f, staged: false, code: f.y });
    }
  }
  return [['Conflicts', conflicts], ['Staged', staged], ['Changes', unstaged], ['Untracked', untracked]]
    .flatMap(([group, list]) => list.map((it) => ({ ...it, group })));
}

function renderFiles() {
  const side = cvEl('cv-files');
  if (!cv.items.length) {
    side.innerHTML = '<p class="help" style="padding:12px 14px">Nothing to commit. The working tree is clean.</p>';
    return;
  }
  let html = '';
  let group = null;
  cv.items.forEach((it, i) => {
    if (it.group !== group) {
      group = it.group;
      const n = cv.items.filter((x) => x.group === group).length;
      html += `<h3>${group} <span class="faint">${n}</span></h3>`;
    }
    const [label, cls] = STATUS[it.code] || [it.code, 'm'];
    const slash = it.f.path.lastIndexOf('/');
    const base = it.f.path.slice(slash + 1);
    const dir = slash >= 0 ? it.f.path.slice(0, slash) : '';
    html += `<button class="cv-file${i === cv.sel ? ' selected' : ''}" data-i="${i}" title="${esc(`${it.f.path} — ${label}${it.f.orig ? ` from ${it.f.orig}` : ''}`)}">
      <span class="st st-${cls}">${it.code === '?' ? 'U' : esc(it.code)}</span>
      <span class="cv-name ellipsis">${esc(base)}</span><span class="cv-dir ellipsis">${esc(dir)}</span>
    </button>`;
  });
  side.innerHTML = html;
}

/** Renders a unified diff with old/new line numbers. Returns the first changed line in the new file. */
function diffHtml(text) {
  let oldN = 0, newN = 0, inHunk = false, first = null;
  const out = [];
  for (const line of text.split('\n')) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
    if (h) {
      oldN = Number(h[1]); newN = Number(h[2]); inHunk = true;
      out.push(`<div class="dl hunk"><span class="ln"></span><span class="ln"></span><span class="code">${esc(line)}</span></div>`);
      continue;
    }
    if (!inHunk) {
      if (/^(new file|deleted file|rename (from|to)|similarity|old mode|new mode)/.test(line)) {
        out.push(`<div class="dl meta"><span class="ln"></span><span class="ln"></span><span class="code">${esc(line)}</span></div>`);
      }
      continue;
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    const c = line[0];
    if (c === '+') {
      first ??= newN;
      out.push(`<div class="dl add"><span class="ln"></span><span class="ln">${newN++}</span><span class="code">${esc(line.slice(1)) || ' '}</span></div>`);
    } else if (c === '-') {
      first ??= Math.max(1, newN);
      out.push(`<div class="dl del"><span class="ln">${oldN++}</span><span class="ln"></span><span class="code">${esc(line.slice(1)) || ' '}</span></div>`);
    } else if (c === ' ') {
      out.push(`<div class="dl"><span class="ln">${oldN++}</span><span class="ln">${newN++}</span><span class="code">${esc(line.slice(1)) || ' '}</span></div>`);
    }
  }
  return { html: out.join(''), first };
}

async function showDiff(i) {
  const it = cv.items[i];
  if (!it) return;
  cv.sel = i;
  document.querySelectorAll('#cv-files .cv-file.selected').forEach((b) => b.classList.remove('selected'));
  const btn = document.querySelector(`#cv-files .cv-file[data-i="${i}"]`);
  btn?.classList.add('selected');
  btn?.scrollIntoView({ block: 'nearest' });
  const deleted = it.code === 'D';
  cvEl('cv-open').disabled = deleted;
  const box = cvEl('cv-diff');
  const seq = ++cv.diffSeq;
  box.innerHTML = '<div class="gv-msgbox">Loading diff…</div>';
  try {
    const d = await invoke('file_diff', { path: cv.project.path, file: it.f.path, staged: it.staged });
    if (seq !== cv.diffSeq) return;
    const head = `<div class="cv-head"><span class="mono selectable">${esc(it.f.orig ? `${it.f.orig} → ${it.f.path}` : it.f.path)}</span>
      <span class="faint">${it.staged ? 'staged' : it.code === '?' ? 'untracked' : 'not staged'}</span></div>`;
    if (d.binary) {
      cv.firstLine = null;
      box.innerHTML = `${head}<div class="gv-msgbox">Binary file — no text diff.</div>`;
      return;
    }
    const { html, first } = diffHtml(d.text);
    cv.firstLine = first;
    box.innerHTML = `${head}<div class="diff">${html || '<div class="gv-msgbox">No content changes (mode or whitespace only).</div>'}</div>`
      + (d.truncated ? '<div class="more">Diff truncated: the file is too large to show in full.</div>' : '');
    box.scrollTop = 0;
  } catch (err) {
    if (seq === cv.diffSeq) box.innerHTML = `<div class="gv-msgbox error">${esc(err)}</div>`;
  }
}

async function loadChanges(keepPath) {
  const seq = ++cv.seq;
  cvEl('cv-reload').classList.add('spinning');
  try {
    const files = await invoke('changed_files', { path: cv.project.path });
    if (seq !== cv.seq) return;
    cv.items = changeItems(files);
    const n = files.length;
    cvEl('cv-meta').textContent = `${n} file${n === 1 ? '' : 's'} changed${n >= 3000 ? ' (first 3000)' : ''}`;
    renderFiles();
    if (!cv.items.length) {
      cv.sel = -1;
      cvEl('cv-open').disabled = true;
      cvEl('cv-diff').innerHTML = '<div class="gv-msgbox">✓ Clean — nothing to show.</div>';
      return;
    }
    const keep = keepPath ? cv.items.findIndex((x) => `${x.staged}:${x.f.path}` === keepPath) : -1;
    showDiff(keep >= 0 ? keep : 0);
  } catch (err) {
    if (seq === cv.seq) cvEl('cv-files').innerHTML = `<div class="gv-msgbox error">${esc(err)}</div>`;
  } finally {
    if (seq === cv.seq) cvEl('cv-reload').classList.remove('spinning');
  }
}

function openChanges(p) {
  cv.project = p;
  cv.items = [];
  cv.sel = -1;
  cvEl('changes-view').hidden = false;
  cvEl('cv-title').textContent = `${p.name} — changes`;
  cvEl('cv-path').textContent = shortPath(p.path);
  cvEl('cv-files').innerHTML = '<div class="gv-msgbox">Loading…</div>';
  cvEl('cv-diff').innerHTML = '';
  loadChanges();
}

function closeChanges() {
  cv.seq++;
  cv.diffSeq++;
  cvEl('changes-view').hidden = true;
  const path = cv.project?.path;
  cv.project = null;
  if (path) select(path);
}

const currentKey = () => { const it = cv.items[cv.sel]; return it ? `${it.staged}:${it.f.path}` : null; };

/** Called when the file watcher rescanned a project. */
function changesProjectUpdated(fresh) {
  if (changesOpen() && cv.project?.path === fresh.path) loadChanges(currentKey());
}

async function openSelectedFile() {
  const it = cv.items[cv.sel];
  if (!it || it.code === 'D') return;
  try {
    await invoke('open_in_editor', { path: cv.project.path, file: it.f.path, line: cv.firstLine ?? undefined });
    markOpened(cv.project);
  } catch (err) {
    toast(String(err), true);
  }
}

cvEl('cv-files').addEventListener('click', (e) => {
  const b = e.target.closest('.cv-file');
  if (b) showDiff(Number(b.dataset.i));
});
cvEl('cv-files').addEventListener('dblclick', (e) => { if (e.target.closest('.cv-file')) openSelectedFile(); });
cvEl('cv-close').addEventListener('click', closeChanges);
cvEl('cv-reload').addEventListener('click', () => cv.project && loadChanges(currentKey()));
cvEl('cv-open').addEventListener('click', openSelectedFile);

document.addEventListener('keydown', (e) => {
  if (!changesOpen() || e.defaultPrevented || document.querySelector('dialog[open]')) return;
  const k = e.key;
  const mod = e.ctrlKey || e.metaKey;
  if (k === 'Escape' || (!mod && k.toLowerCase() === 'c')) { e.preventDefault(); closeChanges(); return; }
  if ((mod && k.toLowerCase() === 'r') || k === 'F5') { e.preventDefault(); loadChanges(currentKey()); return; }
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault();
    if (cv.items.length) showDiff(Math.min(cv.items.length - 1, Math.max(0, cv.sel + (k === 'ArrowDown' ? 1 : -1))));
    return;
  }
  if (k === 'Enter') { e.preventDefault(); openSelectedFile(); }
});
