/* The reader. Each format is read differently, so each gets its own surface:
   manhwa/manhua as one continuous strip, manga paged right to left, novels
   as prose with typography the reader controls. */

import { api, el, esc, toast, KIND_LABEL } from './ui.js';

const PREFS_KEY = 'inkshelf.reader';
const prefs = {
  theme: 'ink',
  size: 1.125,
  layout: 'auto',   // auto | strip | paged
  spread: true,
  ...(() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } })(),
};
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } };

let active = null;

export function isOpen() { return !!active; }

export async function openReader(chapterId, { onClose } = {}) {
  closeReader();
  const host = el(`<div class="reader" data-theme="ink"><div class="reader-stage"><div class="empty"><p>Opening…</p></div></div></div>`);
  document.body.appendChild(host);
  document.body.style.overflow = 'hidden';

  let data;
  try {
    data = await api(`/api/chapters/${encodeURIComponent(chapterId)}`);
  } catch (err) {
    host.remove();
    document.body.style.overflow = '';
    toast(err.message, 'bad');
    return;
  }

  const chapter = data.chapter;
  const isProse = chapter.kind === 'novel';
  const layout = isProse ? 'prose'
    : prefs.layout !== 'auto' ? prefs.layout
    : chapter.kind === 'manga' ? 'paged' : 'strip';

  active = { host, chapter, layout, page: 0, onClose };
  host.dataset.theme = isProse ? prefs.theme : 'ink';

  host.innerHTML = '';
  host.appendChild(buildBar(chapter, isProse));
  const stage = el(`<div class="reader-stage"></div>`);
  host.appendChild(stage);
  host.appendChild(el(`<div class="reader-progress" style="width:0"></div>`));
  active.stage = stage;

  if (layout === 'prose') renderProse(stage, chapter);
  else if (layout === 'paged') renderPaged(stage, chapter);
  else renderStrip(stage, chapter);

  stage.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('keydown', onKey);
  markProgress(chapter.id, 0);
  requestAnimationFrame(() => stage.focus?.());
}

export function closeReader() {
  if (!active) return;
  document.removeEventListener('keydown', onKey);
  active.host.remove();
  document.body.style.overflow = '';
  const { onClose } = active;
  active = null;
  onClose?.();
}

/* ------------------------------------------------------------------- bar */

function buildBar(chapter, isProse) {
  const bar = el(`
    <div class="reader-bar">
      <button class="btn btn-small btn-ghost" data-act="close" aria-label="Close reader">Close</button>
      <div class="reader-title">
        <b>${esc(chapter.series_title)}</b>
        <span>Chapter ${esc(chapter.number)}${chapter.title ? ' — ' + esc(chapter.title) : ''} · ${chapter.index} of ${chapter.total}</span>
      </div>
      <div class="reader-tools">
        <button class="btn btn-small" data-act="prev" ${chapter.prev ? '' : 'disabled'}>Previous</button>
        <button class="btn btn-small" data-act="next" ${chapter.next ? '' : 'disabled'}>Next</button>
        <button class="btn btn-small" data-act="settings" aria-label="Reading settings" aria-expanded="false">Aa</button>
      </div>
    </div>`);

  bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closeReader();
    if (act === 'prev' && chapter.prev) openReader(chapter.prev.id, { onClose: active?.onClose });
    if (act === 'next' && chapter.next) openReader(chapter.next.id, { onClose: active?.onClose });
    if (act === 'settings') toggleSettings(bar, isProse);
  });
  return bar;
}

function toggleSettings(bar, isProse) {
  const open = bar.querySelector('.reader-settings');
  const trigger = bar.querySelector('[data-act="settings"]');
  if (open) { open.remove(); trigger.setAttribute('aria-expanded', 'false'); return; }
  trigger.setAttribute('aria-expanded', 'true');

  const panel = el(`<div class="reader-settings">
    ${isProse ? `
      <h3>Text size</h3>
      <div class="seg" data-group="size">
        ${[0.95, 1.125, 1.3, 1.5].map((s) =>
          `<button type="button" data-value="${s}" aria-pressed="${prefs.size === s}">${Math.round(s * 100 / 1.125)}%</button>`).join('')}
      </div>
      <h3>Page colour</h3>
      <div class="seg" data-group="theme">
        ${[['ink', 'Ink'], ['sepia', 'Sepia'], ['paper', 'Paper']].map(([v, l]) =>
          `<button type="button" data-value="${v}" aria-pressed="${prefs.theme === v}">${l}</button>`).join('')}
      </div>`
    : `
      <h3>Page layout</h3>
      <div class="seg" data-group="layout">
        ${[['auto', 'Auto'], ['strip', 'Scroll'], ['paged', 'Pages']].map(([v, l]) =>
          `<button type="button" data-value="${v}" aria-pressed="${prefs.layout === v}">${l}</button>`).join('')}
      </div>
      <p class="drop-note">Auto scrolls manhwa and manhua, and pages manga right to left.</p>`}
  </div>`);

  panel.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-value]');
    if (!button) return;
    const group = button.closest('[data-group]').dataset.group;
    const raw = button.dataset.value;
    prefs[group] = group === 'size' ? Number(raw) : raw;
    savePrefs();
    panel.querySelectorAll(`[data-group="${group}"] button`).forEach((b) =>
      b.setAttribute('aria-pressed', String(b === button)));
    applyPrefs();
  });

  bar.appendChild(panel);
}

function applyPrefs() {
  if (!active) return;
  const { host, chapter } = active;
  if (chapter.kind === 'novel') {
    host.dataset.theme = prefs.theme;
    host.querySelector('.prose')?.style.setProperty('--prose-size', `${prefs.size}rem`);
  } else {
    openReader(chapter.id, { onClose: active.onClose });
  }
}

/* --------------------------------------------------------------- layouts */

function footer(chapter) {
  return `<div class="reader-foot">
    ${chapter.prev ? `<button class="btn" data-go="${chapter.prev.id}">Previous chapter</button>` : ''}
    <button class="btn btn-ghost" data-act="close">Back to the series</button>
    ${chapter.next ? `<button class="btn btn-primary" data-go="${chapter.next.id}">Next chapter</button>` : ''}
  </div>`;
}

function wireFooter(stage, chapter) {
  stage.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { openReader(Number(go.dataset.go), { onClose: active?.onClose }); return; }
    if (e.target.closest('[data-act="close"]')) closeReader();
  });
}

function renderStrip(stage, chapter) {
  stage.innerHTML =
    `<div class="strip">${chapter.pages.map((p, i) =>
      `<img src="/uploads/${esc(p.file_path)}" alt="Page ${i + 1}" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async">`
    ).join('')}</div>${footer(chapter)}`;
  wireFooter(stage, chapter);
}

function renderPaged(stage, chapter) {
  stage.innerHTML = `<div class="paged"><div class="spread"></div>
    <div class="tap-zones">
      <button data-turn="next" aria-label="Next page"></button>
      <button data-turn="bar" aria-label="Show controls"></button>
      <button data-turn="prev" aria-label="Previous page"></button>
    </div></div>`;

  stage.querySelector('.tap-zones').addEventListener('click', (e) => {
    const turn = e.target.closest('[data-turn]')?.dataset.turn;
    if (turn === 'next') step(1);
    if (turn === 'prev') step(-1);
    if (turn === 'bar') active.host.classList.toggle('immersive');
  });
  paint();
}

/* Manga reads right to left, so a spread shows page n on the right of n+1. */
function paint() {
  if (!active || active.layout !== 'paged') return;
  const { chapter, page, stage } = active;
  const wide = window.innerWidth > 1000 && prefs.spread;
  const shown = wide ? chapter.pages.slice(page, page + 2) : chapter.pages.slice(page, page + 1);
  const spread = stage.querySelector('.spread');
  spread.innerHTML = shown.map((p, i) =>
    `<img class="page-turn" style="--from:${active.dir >= 0 ? '18px' : '-18px'}"
          src="/uploads/${esc(p.file_path)}" alt="Page ${page + i + 1}">`).join('');
  setProgress((page + shown.length) / chapter.pages.length);
  markProgress(chapter.id, page);

  // Warm the next pages so a turn never waits on the network.
  for (let i = page + shown.length; i < Math.min(page + shown.length + 3, chapter.pages.length); i++) {
    new Image().src = `/uploads/${chapter.pages[i].file_path}`;
  }
}

function step(direction) {
  if (!active || active.layout !== 'paged') return;
  const { chapter } = active;
  const stride = window.innerWidth > 1000 && prefs.spread ? 2 : 1;
  const next = active.page + direction * stride;

  if (next >= chapter.pages.length) {
    if (chapter.next) openReader(chapter.next.id, { onClose: active.onClose });
    else toast('That was the last page.');
    return;
  }
  if (next < 0) {
    if (chapter.prev) openReader(chapter.prev.id, { onClose: active.onClose });
    return;
  }
  active.dir = direction;
  active.page = next;
  paint();
}

function renderProse(stage, chapter) {
  const paragraphs = String(chapter.body || '')
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join('');
  stage.innerHTML = `<div class="prose-stage">
      <article class="prose" style="--prose-size:${prefs.size}rem">
        <h1>Chapter ${esc(chapter.number)}${chapter.title ? ` — ${esc(chapter.title)}` : ''}</h1>
        ${paragraphs || '<p>This chapter has no text yet.</p>'}
      </article>
      ${footer(chapter)}
    </div>`;
  wireFooter(stage, chapter);
}

/* ------------------------------------------------------------- behaviour */

let scrollTimer = null;

function onScroll() {
  if (!active || active.layout === 'paged') return;
  const { stage, chapter } = active;
  const max = stage.scrollHeight - stage.clientHeight;
  const ratio = max > 0 ? stage.scrollTop / max : 1;
  setProgress(ratio);

  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    markProgress(chapter.id, Math.round(ratio * Math.max(1, chapter.pages.length)));
  }, 900);
}

function setProgress(ratio) {
  const bar = active?.host.querySelector('.reader-progress');
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
}

function onKey(e) {
  if (!active) return;
  if (e.key === 'Escape') { closeReader(); return; }
  if (e.target.matches('input, textarea')) return;

  const { chapter, layout } = active;
  if (layout === 'paged') {
    // Right-to-left: the right arrow moves backwards through the story.
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(-1); }
    if (e.key === ' ') { e.preventDefault(); step(1); }
  }
  if (e.key === 'n' && chapter.next) openReader(chapter.next.id, { onClose: active.onClose });
  if (e.key === 'p' && chapter.prev) openReader(chapter.prev.id, { onClose: active.onClose });
}

let lastMarked = '';
function markProgress(chapterId, page) {
  const key = `${chapterId}:${page}`;
  if (key === lastMarked) return;
  lastMarked = key;
  api('/api/progress', { method: 'POST', body: { chapterId, page } }).catch(() => { /* signed out */ });
}

window.addEventListener('resize', () => { if (active?.layout === 'paged') paint(); });
