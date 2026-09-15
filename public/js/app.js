/* Router and the bits of behaviour that live outside any single view. */

import { api, el, esc, toast, coverUrl, KIND_LABEL } from './ui.js';
import * as views from './views.js';
import { openReader, closeReader, isOpen } from './reader.js';

const ROUTES = [
  [/^\/$/,                    () => views.home()],
  [/^\/browse$/,              (m, q) => views.browse(q)],
  [/^\/series\/([^/]+)$/,     (m) => views.series(decodeURIComponent(m[1]))],
  [/^\/shelf$/,               () => views.shelf()],
  [/^\/publish$/,             (m, q) => views.publish(q)],
  [/^\/account$/,             (m, q) => views.account(q)],
];

async function render() {
  const { pathname, searchParams } = new URL(location.href);
  if (isOpen()) closeReader();

  for (const [pattern, run] of ROUTES) {
    const match = pattern.exec(pathname);
    if (!match) continue;
    markNav(pathname);
    try {
      await run(match, searchParams);
    } catch (err) {
      console.error(err);
      document.getElementById('main').innerHTML =
        `<div class="wrap"><div class="empty"><h2>That did not load</h2>
         <p>${esc(err.message)}</p>
         <p><button class="btn" onclick="location.reload()">Try again</button></p></div></div>`;
    }
    return;
  }
  views.notFound();
}

function markNav(pathname) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = pathname.startsWith('/' + a.dataset.nav);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.body.classList.remove('menu-open');
  document.getElementById('menuToggle').setAttribute('aria-expanded', 'false');
}

/* Intercept in-app links so navigation never round-trips to the server. */
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]');
  if (!link) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const url = new URL(link.href, location.origin);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  if (url.href === location.href) return;
  history.pushState({}, '', url);
  render();
  window.scrollTo({ top: 0 });
});

window.addEventListener('popstate', render);

/* Views request navigation through an event rather than touching location,
   whose methods browsers keep non-configurable. */
const softAssign = (href) => { history.pushState({}, '', href); render(); window.scrollTo({ top: 0 }); };
window.addEventListener('inkshelf:navigate', (e) => softAssign(e.detail));

/* Chapter rows are keyboard-operable. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('.chapter-row[data-read]');
  if (!row) return;
  e.preventDefault();
  openReader(Number(row.dataset.read), { onClose: render });
});

/* ================================================================= search */

const input = document.getElementById('q');
const panel = document.getElementById('suggest');
let controller = null;
let debounce = null;
let cursor = -1;

function closeSuggest() {
  panel.hidden = true;
  panel.innerHTML = '';
  cursor = -1;
  input.setAttribute('aria-expanded', 'false');
}

async function runSuggest(term) {
  controller?.abort();
  controller = new AbortController();
  try {
    const data = await api(`/api/suggest?q=${encodeURIComponent(term)}`, { signal: controller.signal });
    if (input.value.trim() !== term) return; // a newer keystroke already won

    panel.innerHTML = data.results.length
      ? data.results.map((s) => `
          <button class="suggest-row" role="option" aria-selected="false" data-slug="${esc(s.slug)}">
            <img src="${esc(coverUrl(s))}" alt="" loading="lazy">
            <span><b>${esc(s.title)}</b><span>${esc(KIND_LABEL[s.kind])}${s.author ? ' · ' + esc(s.author) : ''}</span></span>
          </button>`).join('') +
        `<button class="suggest-row" role="option" aria-selected="false" data-all="1">
           <span><b>See all results for “${esc(term)}”</b></span></button>`
      : `<p class="suggest-empty">Nothing matched “${esc(term)}”. Press Enter to search anyway.</p>`;

    panel.hidden = false;
    cursor = -1;
    input.setAttribute('aria-expanded', 'true');
  } catch (err) {
    if (err.name !== 'AbortError') closeSuggest();
  }
}

input.addEventListener('input', () => {
  const term = input.value.trim();
  clearTimeout(debounce);
  if (term.length < 2) { closeSuggest(); return; }
  debounce = setTimeout(() => runSuggest(term), 170);
});

input.addEventListener('keydown', (e) => {
  const options = [...panel.querySelectorAll('.suggest-row')];
  if (e.key === 'Enter') {
    e.preventDefault();
    if (cursor >= 0 && options[cursor]) { options[cursor].click(); return; }
    const term = input.value.trim();
    if (term) { closeSuggest(); input.blur(); softAssign(`/browse?q=${encodeURIComponent(term)}`); }
    return;
  }
  if (e.key === 'Escape') { closeSuggest(); input.blur(); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (!options.length) return;
  e.preventDefault();
  cursor = e.key === 'ArrowDown'
    ? (cursor + 1) % options.length
    : (cursor - 1 + options.length) % options.length;
  options.forEach((o, i) => o.setAttribute('aria-selected', String(i === cursor)));
  options[cursor].scrollIntoView({ block: 'nearest' });
});

panel.addEventListener('click', (e) => {
  const row = e.target.closest('.suggest-row');
  if (!row) return;
  const term = input.value.trim();
  closeSuggest();
  input.blur();
  softAssign(row.dataset.all ? `/browse?q=${encodeURIComponent(term)}` : `/series/${row.dataset.slug}`);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search')) closeSuggest();
});

/* "/" focuses the search box, the way a reader expects. */
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
  if (document.activeElement?.matches('input, textarea, select')) return;
  if (isOpen()) return;
  e.preventDefault();
  input.focus();
  input.select();
});

/* ================================================================ account */

function paintAccount() {
  const host = document.getElementById('account');
  host.innerHTML = views.state.user
    ? `<a class="btn btn-small" href="/account" data-link>${esc(views.state.user.display_name)}</a>`
    : `<a class="btn btn-small btn-ghost" href="/account" data-link>Sign in</a>
       <a class="btn btn-small btn-primary" href="/account?mode=register" data-link>Join</a>`;
}
window.addEventListener('inkshelf:user', paintAccount);

document.getElementById('menuToggle').addEventListener('click', (e) => {
  const open = document.body.classList.toggle('menu-open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
});

/* =================================================================== boot */

(async function boot() {
  try {
    const me = await api('/api/auth/me');
    views.state.user = me.user;
  } catch { /* offline: carry on signed out */ }
  paintAccount();

  // Reflect a search already in the address bar.
  const q = new URL(location.href).searchParams.get('q');
  if (q && location.pathname === '/browse') input.value = q;

  await render();
})();
