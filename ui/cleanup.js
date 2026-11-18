'use strict';
/* Clean up branches: delete local branches that are merged or whose upstream was deleted. */

const cu = { project: null, data: null };
const cuDlg = document.getElementById('cleanup');

function cleanupRows() {
  const { base, branches } = cu.data;
  if (!branches.length) {
    return `<p class="help" style="margin-top:14px">Nothing to clean up. Every local branch is either <b>${esc(base || 'the current branch')}</b>, checked out, or has work that isn't merged yet.</p>`;
  }
  return `<p class="help" style="margin-top:12px">Local branches only. Remote branches are never touched, and you can recreate a deleted branch from its remote or with <span class="mono">git reflog</span>.</p>
    <ul class="cu-list">${branches.map((b, i) => {
      const why = b.merged && b.gone ? `merged into ${base} · upstream deleted`
        : b.merged ? `merged into ${base}`
          : 'upstream deleted · NOT merged';
      return `<li class="${b.merged ? '' : 'unmerged'}">
        <label class="check">
          <input type="checkbox" data-i="${i}" ${b.merged ? 'checked' : ''}>
          <span class="cu-name mono">${esc(b.name)}</span>
        </label>
        <span class="cu-why${b.merged ? '' : ' warn'}">${b.merged ? '' : icon('warn')}${esc(why)}</span>
        <span class="faint cu-sub ellipsis" title="${esc(b.subject)}">${esc(b.subject)}</span>
        <span class="faint nowrap">${ago(b.timestamp)}</span>
      </li>`;
    }).join('')}</ul>`;
}

function updateCleanupButton() {
  const boxes = [...cuDlg.querySelectorAll('input[data-i]')];
  const picked = boxes.filter((b) => b.checked).map((b) => cu.data.branches[Number(b.dataset.i)]);
  const unmerged = picked.filter((b) => !b.merged).length;
  const go = document.getElementById('cleanup-go');
  go.disabled = !picked.length;
  go.textContent = picked.length ? `Delete ${picked.length} branch${picked.length === 1 ? '' : 'es'}` : 'Delete';
  document.getElementById('cleanup-note').textContent = unmerged
    ? `${unmerged} unmerged — their commits will only be reachable from the remote or reflog.` : '';
}

async function openCleanup(p) {
  cu.project = p;
  cu.data = null;
  document.getElementById('cleanup-title').textContent = `Clean up branches — ${p.name}`;
  const body = document.getElementById('cleanup-body');
  body.innerHTML = '<div class="gv-msgbox">Looking for merged and orphaned branches…</div>';
  document.getElementById('cleanup-note').textContent = '';
  document.getElementById('cleanup-go').disabled = true;
  cuDlg.showModal();
  try {
    cu.data = await invoke('stale_branches', { path: p.path });
    body.innerHTML = cleanupRows();
    updateCleanupButton();
  } catch (err) {
    body.innerHTML = `<div class="gv-msgbox error">${esc(err)}</div>`;
  }
}

cuDlg.addEventListener('change', (e) => { if (e.target.matches('input[data-i]')) updateCleanupButton(); });
cuDlg.addEventListener('click', (e) => {
  if (e.target === cuDlg || e.target.closest('[data-close]')) cuDlg.close();
});
document.getElementById('cleanup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const picked = [...cuDlg.querySelectorAll('input[data-i]:checked')].map((b) => cu.data.branches[Number(b.dataset.i)]);
  if (!picked.length) return;
  const go = document.getElementById('cleanup-go');
  go.disabled = true;
  try {
    const results = await invoke('delete_branches', {
      path: cu.project.path,
      names: picked.map((b) => b.name),
      force: picked.some((b) => !b.merged),
    });
    const failed = results.filter((r) => !r.ok);
    cuDlg.close();
    toast(failed.length
      ? `Deleted ${results.length - failed.length}; couldn't delete ${failed.map((f) => `${f.name} (${f.error})`).join(', ')}`
      : `Deleted ${results.length} branch${results.length === 1 ? '' : 'es'}`, failed.length > 0);
    if (graphOpen() && gv.project?.path === cu.project.path) openGraph(gv.project, gv.limit);
  } catch (err) {
    toast(String(err), true);
    go.disabled = false;
  }
});
