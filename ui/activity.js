'use strict';
/* Activity view: your commits across all projects as a calendar heatmap, plus per-project activity. */

const av = { data: null, seq: 0 };
const avEl = (id) => document.getElementById(id);
const activityOpen = () => !avEl('activity-view').hidden;
const DAY = 86_400;
const CELL = 12, GAP = 3;

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/** 0 = none, 1–4 = quartile-ish buckets relative to your busiest days. */
function levelFor(n, max) {
  if (!n) return 0;
  if (max <= 4) return Math.min(4, n);
  const r = n / max;
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

function computeStats(byDay, today) {
  let active = 0, longest = 0, run = 0, busiest = null;
  const first = addDays(today, -364);
  for (let d = first; d <= today; d = addDays(d, 1)) {
    const n = byDay.get(dayKey(d)) || 0;
    if (n) { active++; run++; longest = Math.max(longest, run); } else run = 0;
    if (n && (!busiest || n > busiest.n)) busiest = { d, n };
  }
  // Current streak: today if you've committed, otherwise counting from yesterday.
  let streak = 0;
  let d = (byDay.get(dayKey(today)) || 0) ? today : addDays(today, -1);
  while (byDay.get(dayKey(d))) { streak++; d = addDays(d, -1); }
  return { active, longest, streak, busiest };
}

function heatmapSvg(byDay, today) {
  // 53 columns of weeks, Monday on top, ending with the current week.
  const mondayOffset = (today.getDay() + 6) % 7;
  const start = addDays(today, -mondayOffset - 52 * 7);
  const max = Math.max(1, ...byDay.values());
  const left = 30, top = 18;
  let cells = '', months = '';
  let lastMonth = -1;
  for (let w = 0; w < 53; w++) {
    const weekStart = addDays(start, w * 7);
    if (weekStart.getMonth() !== lastMonth && weekStart.getDate() <= 7) {
      lastMonth = weekStart.getMonth();
      months += `<text x="${left + w * (CELL + GAP)}" y="11">${weekStart.toLocaleDateString(undefined, { month: 'short' })}</text>`;
    }
    for (let dow = 0; dow < 7; dow++) {
      const d = addDays(weekStart, dow);
      if (d > today) continue;
      const n = byDay.get(dayKey(d)) || 0;
      const x = left + w * (CELL + GAP), y = top + dow * (CELL + GAP);
      cells += `<rect class="hm l${levelFor(n, max)}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" data-tip="${esc(`${n ? `${n} commit${n === 1 ? '' : 's'}` : 'No commits'} · ${fmtDay(d)}`)}"/>`;
    }
  }
  const days = ['Mon', '', 'Wed', '', 'Fri', '', ''].map((t, i) => t && `<text x="0" y="${top + i * (CELL + GAP) + 10}">${t}</text>`).join('');
  const w = left + 53 * (CELL + GAP), h = top + 7 * (CELL + GAP);
  return `<svg class="heatmap" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Commits per day over the last year">
    <g class="hm-labels">${months}${days}</g>${cells}</svg>`;
}

/** Weekly commit counts for the last 12 weeks, as small bars. */
function sparkline(commits, now) {
  const weeks = new Array(12).fill(0);
  for (const t of commits) {
    const age = Math.floor((now - t) / (7 * DAY));
    if (age >= 0 && age < 12) weeks[11 - age]++;
  }
  const max = Math.max(1, ...weeks);
  const bw = 6, gap = 2, h = 22;
  const bars = weeks.map((n, i) => {
    const bh = n ? Math.max(3, Math.round((n / max) * h)) : 1;
    return `<rect class="${n ? 'sp' : 'sp0'}" x="${i * (bw + gap)}" y="${h - bh}" width="${bw}" height="${bh}" rx="${n ? 1.5 : 0}"><title>${n} commit${n === 1 ? '' : 's'}, ${11 - i ? `${11 - i} week${11 - i === 1 ? '' : 's'} ago` : 'this week'}</title></rect>`;
  }).join('');
  return `<svg class="spark" width="${12 * (bw + gap) - gap}" height="${h}" aria-hidden="true">${bars}</svg>`;
}

function renderActivity() {
  const now = Date.now() / 1000;
  const today = startOfDay(new Date());
  const hidden = new Set(state.config.hidden);
  const byDay = new Map();
  const rows = [];
  for (const a of av.data) {
    const p = byPath(a.path);
    if (!p || hidden.has(p.path)) continue;
    for (const t of a.commits) {
      const k = dayKey(new Date(t * 1000));
      byDay.set(k, (byDay.get(k) || 0) + 1);
    }
    const in30 = a.commits.filter((t) => now - t < 30 * DAY).length;
    rows.push({ p, a, in30, total: a.commits.filter((t) => now - t < 365 * DAY).length, last: p.git?.lastCommit?.timestamp || 0 });
  }
  const total = rows.reduce((n, r) => n + r.total, 0);
  const s = computeStats(byDay, today);
  rows.sort((x, y) => y.in30 - x.in30 || y.total - x.total || y.last - x.last);

  // Projects that need a look: work sitting uncommitted/unpushed, or untouched for a long time.
  const gitRows = rows.filter((r) => r.p.git && !r.p.git.error);
  const waiting = gitRows.filter((r) => (changes(r.p) > 0 || r.p.git.ahead > 0) && now - r.last > 14 * DAY);
  const dormant = gitRows.filter((r) => r.last && now - r.last > 90 * DAY && !waiting.includes(r));

  const tile = (value, label, sub = '') => `<div class="tile"><div class="tile-v">${value}</div><div class="tile-l">${label}</div>${sub ? `<div class="tile-s">${sub}</div>` : ''}</div>`;
  const projectLink = (r, extra) => `<button class="av-proj" data-path="${esc(r.p.path)}"><span class="ellipsis">${esc(r.p.name)}</span><span class="faint nowrap">${extra}</span></button>`;
  const emails = [...new Set(av.data.map((a) => a.email).filter(Boolean))];

  avEl('av-body').innerHTML = `
    <div class="tiles">
      ${tile(total.toLocaleString(), 'commits', 'last 12 months')}
      ${tile(s.active, 'active days', `${Math.round((s.active / 365) * 100)}% of days`)}
      ${tile(s.streak, 'day streak', s.streak ? 'current' : 'commit today to start one')}
      ${tile(s.longest, 'longest streak', 'days in a row')}
      ${tile(s.busiest ? s.busiest.n : 0, 'busiest day', s.busiest ? s.busiest.d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—')}
    </div>
    <section class="av-card">
      <div class="av-card-head"><h3>Commits per day</h3>
        <span class="hm-legend">Less ${[0, 1, 2, 3, 4].map((l) => `<span class="hm-key l${l}"></span>`).join('')} More</span></div>
      <div class="hm-wrap">${heatmapSvg(byDay, today)}</div>
      <p class="help">Counts your commits on every branch (merges excluded)${emails.length ? `, matched by ${emails.map((e) => `<span class="mono">${esc(e)}</span>`).join(', ')}` : ''}.</p>
    </section>
    <div class="av-cols">
      <section class="av-card">
        <div class="av-card-head"><h3>By project</h3><span class="faint">sorted by last 30 days</span></div>
        <table class="av-table">
          <thead><tr><th>Project</th><th>Last 12 weeks</th><th class="num">30 days</th><th class="num">12 months</th><th class="num">Last commit</th></tr></thead>
          <tbody>${rows.filter((r) => r.p.git).map((r) => `<tr data-path="${esc(r.p.path)}">
            <td class="ellipsis"><b>${esc(r.p.name)}</b></td>
            <td>${sparkline(r.a.commits, now)}</td>
            <td class="num">${r.in30 || '<span class="faint">0</span>'}</td>
            <td class="num">${r.total || '<span class="faint">0</span>'}</td>
            <td class="num faint">${r.last ? ago(r.last) : '—'}</td></tr>`).join('')}</tbody>
        </table>
      </section>
      <div class="av-side">
        <section class="av-card">
          <div class="av-card-head"><h3>${icon('warn')} Work waiting</h3><span class="faint">${waiting.length}</span></div>
          <p class="help">Uncommitted or unpushed changes, no commit for 2+ weeks.</p>
          ${waiting.length ? waiting.map((r) => projectLink(r, [changes(r.p) && `${changes(r.p)} changed`, r.p.git.ahead && `↑${r.p.git.ahead}`, ago(r.last)].filter(Boolean).join(' · '))).join('') : '<p class="faint">Nothing waiting. Nice.</p>'}
        </section>
        <section class="av-card">
          <div class="av-card-head"><h3>Dormant</h3><span class="faint">${dormant.length}</span></div>
          <p class="help">No commits in 90+ days.</p>
          ${dormant.length ? dormant.map((r) => projectLink(r, ago(r.last))).join('') : '<p class="faint">None.</p>'}
        </section>
      </div>
    </div>`;
}

async function openActivity() {
  const seq = ++av.seq;
  avEl('activity-view').hidden = false;
  if (!av.data) avEl('av-body').innerHTML = '<div class="gv-msgbox">Reading commit history…</div>';
  avEl('av-reload').classList.add('spinning');
  try {
    const paths = state.projects.filter((p) => p.git && !p.git.error).map((p) => p.path);
    const data = await invoke('activity', { paths, days: 371 });
    if (seq !== av.seq) return;
    av.data = data;
    renderActivity();
  } catch (err) {
    if (seq === av.seq) avEl('av-body').innerHTML = `<div class="gv-msgbox error">${esc(err)}</div>`;
  } finally {
    if (seq === av.seq) avEl('av-reload').classList.remove('spinning');
  }
}

function closeActivity() {
  av.seq++;
  avEl('activity-view').hidden = true;
  hideTip();
}

/* hover tooltip for heatmap cells */
const tipEl = document.createElement('div');
tipEl.className = 'chart-tip';
document.body.appendChild(tipEl);
function hideTip() { tipEl.classList.remove('show'); }
avEl('av-body').addEventListener('mousemove', (e) => {
  const cell = e.target.closest('[data-tip]');
  if (!cell) { hideTip(); return; }
  tipEl.textContent = cell.dataset.tip;
  const r = cell.getBoundingClientRect();
  tipEl.classList.add('show');
  const tw = tipEl.offsetWidth;
  tipEl.style.left = `${Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2))}px`;
  tipEl.style.top = `${r.top - tipEl.offsetHeight - 6}px`;
});
avEl('av-body').addEventListener('mouseleave', hideTip);

// Clicking a project goes back to the list with it selected.
avEl('av-body').addEventListener('click', (e) => {
  const hit = e.target.closest('[data-path]');
  if (!hit) return;
  closeActivity();
  if (state.filter !== 'all' && !state.view.some((p) => p.path === hit.dataset.path)) { state.filter = 'all'; render(); }
  select(hit.dataset.path);
});
avEl('av-close').addEventListener('click', closeActivity);
avEl('av-reload').addEventListener('click', openActivity);
document.addEventListener('keydown', (e) => {
  if (!activityOpen() || e.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape' || (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'a')) { e.preventDefault(); closeActivity(); }
});
