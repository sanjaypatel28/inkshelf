/* One function per route. Each renders into <main> and wires its own events. */

import {
  api, el, esc, toast, card, stars, coverUrl, compact, ago, go,
  KIND_LABEL, STATUS_LABEL, skeletonGrid,
} from './ui.js';
import { openReader } from './reader.js';

const main = () => document.getElementById('main');
const setTitle = (t) => { document.title = t ? `${t} — Inkshelf` : 'Inkshelf'; };

export const state = { user: null };

/* =================================================================== home */

export async function home() {
  setTitle('');
  main().innerHTML = `<div class="wrap">${skeletonGrid(8)}</div>`;

  const data = await api('/api/home');
  const lead = data.spotlight[0];
  const rest = data.spotlight.slice(1, 7);

  const panel = (s, i, big = false) => `
    <a class="panel" href="/series/${esc(s.slug)}" data-link style="--i:${i}">
      <img src="${esc(coverUrl(s))}" alt="" loading="${i < 3 ? 'eager' : 'lazy'}" aria-hidden="true">
      <span class="panel-body">
        <span class="panel-meta">
          <span class="chip" data-kind="${esc(s.kind)}">${esc(KIND_LABEL[s.kind])}</span>
          ${s.rating ? `<span class="card-meta">${s.rating.toFixed(1)}</span>` : ''}
        </span>
        <span class="panel-title">${esc(s.title)}</span>
        ${big ? `<span class="panel-blurb">${esc(s.synopsis)}</span>` : ''}
      </span>
    </a>`;

  main().innerHTML = `
    <div class="wrap">
      <div class="page-grid">
        ${lead ? panel(lead, 0, true) : ''}
        ${rest.map((s, i) => panel(s, i + 1)).join('')}
      </div>

      ${data.continueReading.length ? `
        <section class="section">
          <div class="section-head"><h2>Pick up where you stopped</h2></div>
          <div class="rail">
            ${data.continueReading.map((r) => card(r, `
              <span class="progress"><i style="width:${Math.min(100, Math.round(r.chapter_number / Math.max(1, r.chapter_count) * 100))}%"></i></span>
              <span class="card-meta">Chapter ${esc(r.chapter_number)} of ${esc(r.chapter_count)}</span>`)).join('')}
          </div>
        </section>` : ''}

      ${data.rails.map((rail) => `
        <section class="section">
          <div class="section-head">
            <h2>${esc(rail.title)}</h2>
            <a href="/browse${rail.id === 'fresh' ? '' : `?kind=${rail.id}`}" data-link>See all ${rail.items.length > 11 ? '' : ''}</a>
          </div>
          <div class="rail">${rail.items.map((s) => card(s)).join('')}</div>
        </section>`).join('')}

      <section class="section">
        <div class="section-head"><h2>Browse by genre</h2></div>
        <div class="filters" style="border:0;padding:0;margin:0">
          ${data.genres.map((g) => `<a class="tag" href="/browse?genre=${encodeURIComponent(g.name)}" data-link>${esc(g.name)} ${g.count}</a>`).join('')}
        </div>
      </section>
    </div>`;
}

/* ================================================================= browse */

const SORT_LABELS = {
  updated: 'Recently updated',
  newest: 'Newest',
  reads: 'Most read',
  rating: 'Highest rated',
  title: 'A to Z',
};

export async function browse(query) {
  const q = query.get('q') || '';
  const kind = query.get('kind') || '';
  const genre = query.get('genre') || '';
  const status = query.get('status') || '';
  const sort = query.get('sort') || (q ? 'updated' : 'updated');
  const page = Number(query.get('page')) || 1;

  setTitle(q ? `Search: ${q}` : genre ? genre : kind ? KIND_LABEL[kind] : 'Browse');

  const heading = q ? `Results for “${esc(q)}”` : genre ? esc(genre) : kind ? KIND_LABEL[kind] : 'Everything';

  main().innerHTML = `
    <div class="wrap">
      <h1>${heading}</h1>
      <div class="filters">
        <div class="filter-group" data-filter="kind">
          ${[['', 'All formats'], ['manga', 'Manga'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua'], ['novel', 'Novels']]
            .map(([v, l]) => `<button type="button" data-value="${v}" aria-pressed="${kind === v}">${l}</button>`).join('')}
        </div>
        <select data-filter="status" aria-label="Publication status">
          ${[['', 'Any status'], ['ongoing', 'Ongoing'], ['complete', 'Complete'], ['hiatus', 'On hiatus']]
            .map(([v, l]) => `<option value="${v}" ${status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select data-filter="sort" aria-label="Sort order">
          ${Object.entries(SORT_LABELS).map(([v, l]) => `<option value="${v}" ${sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        ${genre ? `<a class="tag" href="/browse" data-link>Clear ${esc(genre)}</a>` : ''}
        <span class="filters-spacer"></span>
        <span class="result-count" id="count"></span>
      </div>
      <div id="results">${skeletonGrid(12)}</div>
    </div>`;

  main().querySelector('.filters').addEventListener('click', (e) => {
    const button = e.target.closest('.filter-group button');
    if (!button) return;
    navigateWith(query, { kind: button.dataset.value, page: 1 });
  });
  main().querySelectorAll('.filters select').forEach((select) => {
    select.addEventListener('change', () => navigateWith(query, { [select.dataset.filter]: select.value, page: 1 }));
  });

  const params = new URLSearchParams({ sort, page: String(page) });
  if (q) params.set('q', q);
  if (kind) params.set('kind', kind);
  if (genre) params.set('genre', genre);
  if (status) params.set('status', status);

  const data = await api(`/api/series?${params}`);
  document.getElementById('count').textContent =
    data.total === 0 ? '' : `${data.total} ${data.total === 1 ? 'title' : 'titles'}`;

  const results = document.getElementById('results');
  if (!data.items.length) {
    results.innerHTML = `<div class="empty">
      <h2>Nothing matched</h2>
      <p>${q ? 'Try fewer words, or a different spelling.' : 'No titles fit those filters yet.'}</p>
      <p><a href="/browse" data-link>Clear the filters</a></p>
    </div>`;
    return;
  }

  results.innerHTML =
    `<div class="grid">${data.items.map((s) => card(s)).join('')}</div>` +
    (data.pages > 1 ? `<div class="pager">
      <button class="btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      <span>Page ${page} of ${data.pages}</span>
      <button class="btn" data-page="${page + 1}" ${page >= data.pages ? 'disabled' : ''}>Next</button>
    </div>` : '');

  results.querySelector('.pager')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b && !b.disabled) { navigateWith(query, { page: b.dataset.page }); window.scrollTo({ top: 0 }); }
  });
}

function navigateWith(query, changes) {
  const next = new URLSearchParams(query);
  for (const [k, v] of Object.entries(changes)) {
    if (v === '' || v == null) next.delete(k); else next.set(k, v);
  }
  const qs = next.toString();
  history.pushState({}, '', `/browse${qs ? '?' + qs : ''}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/* ================================================================= series */

export async function series(slug) {
  main().innerHTML = `<div class="wrap">${skeletonGrid(1)}</div>`;
  let data;
  try {
    data = await api(`/api/series/${encodeURIComponent(slug)}`);
  } catch {
    main().innerHTML = `<div class="wrap"><div class="empty"><h2>That series is not here</h2>
      <p>The link may be old, or the series was taken down.</p>
      <p><a href="/browse" data-link>Browse everything</a></p></div></div>`;
    return;
  }

  const s = data.series;
  setTitle(s.title);
  const readIds = new Set();
  const firstChapter = data.chapters[0];
  const resume = data.progress ? data.chapters.find((c) => c.id === data.progress.chapter_id) : null;
  if (resume) for (const c of data.chapters) { if (c.number <= resume.number) readIds.add(c.id); }

  main().innerHTML = `
    <div class="series-hero">
      <div class="series-backdrop" aria-hidden="true"><img src="${esc(coverUrl(s))}" alt=""></div>
      <div class="wrap series-top">
        <div>
          <div class="cover"><img src="${esc(coverUrl(s))}" alt="Cover of ${esc(s.title)}"></div>
        </div>
        <div>
          <h1 class="series-title">${esc(s.title)}</h1>
          ${s.alt_title ? `<p class="series-alt">${esc(s.alt_title)}</p>` : ''}
          <div class="series-meta">
            <span class="chip" data-kind="${esc(s.kind)}">${esc(KIND_LABEL[s.kind])}</span>
            <span class="tag">${esc(STATUS_LABEL[s.status])}</span>
            ${s.genres.map((g) => `<a class="tag" href="/browse?genre=${encodeURIComponent(g)}" data-link>${esc(g)}</a>`).join('')}
          </div>
          <p class="series-synopsis">${esc(s.synopsis)}</p>

          <div class="stats">
            <div class="stat"><b>${compact(s.reads)}</b><span>reads</span></div>
            <div class="stat"><b>${s.chapter_count}</b><span>chapters</span></div>
            <div class="stat"><b>${s.rating ? s.rating.toFixed(1) : '—'}</b><span>${s.rating_count} ratings</span></div>
            <div class="stat"><b>${esc(s.author || '—')}</b><span>${s.kind === 'novel' ? 'author' : 'story'}</span></div>
          </div>

          <div class="series-actions">
            ${firstChapter ? `<button class="btn btn-primary" data-read="${resume ? resume.id : firstChapter.id}">
              ${resume ? `Continue chapter ${esc(resume.number)}` : 'Start reading'}</button>` : ''}
            <button class="btn" data-act="shelf" aria-pressed="${data.shelved}">
              ${data.shelved ? 'On your shelf' : 'Add to shelf'}</button>
            ${data.owned ? `<a class="btn btn-ghost" href="/publish?series=${s.id}" data-link>Add a chapter</a>` : ''}
          </div>

          <div class="series-meta">
            <span class="result-count">Your rating</span>
            ${stars(data.myRating || 0, true)}
          </div>
        </div>
      </div>
    </div>

    <div class="wrap">
      <section class="section">
        <div class="section-head">
          <h2>Chapters</h2>
          <button class="btn btn-small btn-ghost" data-act="reverse">Newest first</button>
        </div>
        ${data.chapters.length ? `<div class="chapters" id="chapters">
          ${data.chapters.map((c) => chapterRow(c, s, readIds)).join('')}
        </div>` : `<div class="empty"><h2>No chapters yet</h2><p>This series has been set up but nothing is published.</p></div>`}
      </section>
    </div>`;

  const root = main();
  root.addEventListener('click', async (e) => {
    const readButton = e.target.closest('[data-read]');
    if (readButton) { openReader(Number(readButton.dataset.read), { onClose: () => series(slug) }); return; }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'shelf') {
      if (!state.user) { toast('Sign in to keep a shelf.', 'bad'); go('/account'); return; }
      const button = e.target.closest('[data-act="shelf"]');
      try {
        const res = await api(`/api/shelf/${s.id}`, { method: 'POST' });
        button.setAttribute('aria-pressed', String(res.shelved));
        button.textContent = res.shelved ? 'On your shelf' : 'Add to shelf';
        toast(res.shelved ? 'Added to your shelf.' : 'Removed from your shelf.');
      } catch (err) { toast(err.message, 'bad'); }
    }
    if (act === 'reverse') {
      const list = document.getElementById('chapters');
      const button = e.target.closest('[data-act="reverse"]');
      const reversed = button.dataset.on === '1';
      list.style.display = 'flex';
      list.style.flexDirection = reversed ? 'column' : 'column-reverse';
      button.dataset.on = reversed ? '0' : '1';
      button.textContent = reversed ? 'Newest first' : 'Oldest first';
    }

    const star = e.target.closest('.stars button[data-score]');
    if (star) {
      if (!state.user) { toast('Sign in to rate a series.', 'bad'); return; }
      try {
        const res = await api(`/api/rate/${s.id}`, { method: 'POST', body: { score: Number(star.dataset.score) } });
        star.closest('.stars').outerHTML = stars(res.myRating, true);
        toast(`Rated ${res.myRating} out of 5.`);
      } catch (err) { toast(err.message, 'bad'); }
    }
  });
}

function chapterRow(c, s, readIds) {
  const extra = s.kind === 'novel'
    ? `${Math.max(1, Math.round((c.body_length || 0) / 1400))} min read`
    : `${c.page_count} pages`;
  return `<div class="chapter-row" data-read="${c.id}" data-read-state="${readIds.has(c.id) ? 1 : 0}" role="button" tabindex="0">
    <span class="chapter-no">${esc(c.number)}</span>
    <span class="chapter-name">${esc(c.title || `Chapter ${c.number}`)}</span>
    <span class="chapter-extra">${extra}</span>
    <span class="chapter-extra">${ago(c.created_at)}</span>
  </div>`;
}

/* ================================================================== shelf */

export async function shelf() {
  setTitle('My shelf');
  if (!state.user) return requireAccount('Your shelf lives with your account.');

  main().innerHTML = `<div class="wrap"><h1>My shelf</h1>${skeletonGrid(6)}</div>`;
  const data = await api('/api/shelf');

  main().innerHTML = `<div class="wrap">
    <h1>My shelf</h1>
    ${data.items.length
      ? `<p class="result-count">${data.items.length} saved</p><div class="grid" style="margin-top:1.4rem">${data.items.map((s) => card(s)).join('')}</div>`
      : `<div class="empty"><h2>Nothing saved yet</h2>
          <p>Add a series to your shelf from its page and it will wait for you here.</p>
          <p><a href="/browse" data-link>Find something to read</a></p></div>`}
  </div>`;
}

/* ================================================================ publish */

export async function publish(query) {
  setTitle('Publish');
  if (!state.user) return requireAccount('Publishing needs an account so your work stays yours.');

  const mine = await api('/api/mine');
  const preselect = query.get('series') || '';
  const tab = preselect ? 'chapter' : (query.get('tab') || 'series');

  main().innerHTML = `<div class="wrap">
    <h1>Publish</h1>
    <p class="result-count">Upload work you made or have the rights to share.</p>
    <div class="tabs" role="tablist" style="margin-top:1.6rem">
      <button role="tab" data-tab="series" aria-selected="${tab === 'series'}">New series</button>
      <button role="tab" data-tab="chapter" aria-selected="${tab === 'chapter'}">Add a chapter</button>
      <button role="tab" data-tab="mine" aria-selected="${tab === 'mine'}">Your ${mine.items.length} series</button>
    </div>
    <div id="panel"></div>
  </div>`;

  const panel = document.getElementById('panel');
  const show = (name) => {
    main().querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    if (name === 'series') seriesForm(panel);
    else if (name === 'chapter') chapterForm(panel, mine.items, preselect);
    else mineList(panel, mine.items);
  };
  main().querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) show(b.dataset.tab);
  });
  show(tab);
}

function seriesForm(host) {
  host.innerHTML = `<form class="form form-wide" id="newSeries">
    <div id="err"></div>
    <div class="field">
      <label for="f-title">Title</label>
      <input id="f-title" name="title" type="text" required maxlength="160" placeholder="The name readers will search for">
    </div>
    <div class="field">
      <label for="f-alt">Also known as</label>
      <input id="f-alt" name="alt_title" type="text" maxlength="160" placeholder="Optional — a second title or translation">
    </div>
    <div class="field">
      <label for="f-kind">Format</label>
      <select id="f-kind" name="kind" required>
        <option value="manhwa">Manhwa — full colour, read by scrolling</option>
        <option value="manga">Manga — pages, read right to left</option>
        <option value="manhua">Manhua — full colour, read by scrolling</option>
        <option value="novel">Novel — prose chapters</option>
      </select>
      <p class="hint">This sets how chapters are shown to readers.</p>
    </div>
    <div class="field">
      <label for="f-status">Status</label>
      <select id="f-status" name="status">
        <option value="ongoing">Ongoing</option>
        <option value="complete">Complete</option>
        <option value="hiatus">On hiatus</option>
      </select>
    </div>
    <div class="field">
      <label for="f-synopsis">Synopsis</label>
      <textarea id="f-synopsis" name="synopsis" maxlength="4000" placeholder="What happens, and why someone should start reading."></textarea>
    </div>
    <div class="field">
      <label for="f-genres">Genres</label>
      <input id="f-genres" name="genres" type="text" placeholder="Fantasy, Mystery, Slice of Life">
      <p class="hint">Separate with commas. Up to ten.</p>
    </div>
    <div class="field">
      <label>Cover</label>
      <label class="drop" id="coverDrop">
        <input type="file" name="cover" accept="image/png,image/jpeg,image/webp,image/avif,image/gif">
        <span>Drop a cover here, or choose a file</span>
        <span class="drop-note">Portrait works best, around 600 by 860.</span>
      </label>
      <div class="thumbs" id="coverPreview"></div>
    </div>
    <button class="btn btn-primary" type="submit">Create the series</button>
  </form>`;

  const form = host.querySelector('#newSeries');
  wireDrop(form.querySelector('#coverDrop'), form.querySelector('#coverPreview'), false);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = 'Creating…';
    try {
      const res = await api('/api/series', { method: 'POST', body: new FormData(form) });
      toast('Series created.');
      go(`/series/${res.series.slug}`);
    } catch (err) {
      showError(form.querySelector('#err'), err.message);
      button.disabled = false;
      button.textContent = 'Create the series';
    }
  });
}

function chapterForm(host, items, preselect) {
  if (!items.length) {
    host.innerHTML = `<div class="empty"><h2>No series yet</h2>
      <p>Create a series first, then chapters have somewhere to go.</p></div>`;
    return;
  }
  host.innerHTML = `<form class="form form-wide" id="newChapter">
    <div id="err"></div>
    <div class="field">
      <label for="c-series">Series</label>
      <select id="c-series" name="series" required>
        ${items.map((s) => `<option value="${s.id}" data-kind="${esc(s.kind)}" data-next="${s.chapter_count + 1}"
          ${String(s.id) === String(preselect) ? 'selected' : ''}>${esc(s.title)} (${esc(KIND_LABEL[s.kind])})</option>`).join('')}
      </select>
    </div>
    <div class="field" style="display:grid;grid-template-columns:120px 1fr;gap:1rem">
      <span><label for="c-number">Number</label>
        <input id="c-number" name="number" type="number" step="0.1" min="0" required></span>
      <span><label for="c-title">Chapter title</label>
        <input id="c-title" name="title" type="text" maxlength="200" placeholder="Optional"></span>
    </div>
    <div id="payload"></div>
    <button class="btn btn-primary" type="submit">Publish the chapter</button>
  </form>`;

  const form = host.querySelector('#newChapter');
  const select = form.querySelector('#c-series');
  const payload = form.querySelector('#payload');

  const refresh = () => {
    const option = select.selectedOptions[0];
    form.querySelector('#c-number').value = option.dataset.next;
    if (option.dataset.kind === 'novel') {
      payload.innerHTML = `<div class="field">
        <label for="c-body">Chapter text</label>
        <textarea id="c-body" name="body" style="min-height:340px" placeholder="Paste or write the chapter. Leave a blank line between paragraphs."></textarea>
        <p class="hint" id="wordcount">0 words</p>
      </div>`;
      const area = payload.querySelector('#c-body');
      area.addEventListener('input', () => {
        const words = area.value.trim().split(/\s+/).filter(Boolean).length;
        payload.querySelector('#wordcount').textContent = `${words} words`;
      });
    } else {
      payload.innerHTML = `<div class="field">
        <label>Pages</label>
        <label class="drop" id="pageDrop">
          <input type="file" name="pages" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" multiple>
          <span>Drop the page images here, or choose files</span>
          <span class="drop-note">They are ordered by filename, so number them 01, 02, 03.</span>
        </label>
        <div class="thumbs" id="pagePreview"></div>
      </div>`;
      wireDrop(payload.querySelector('#pageDrop'), payload.querySelector('#pagePreview'), true);
    }
  };
  select.addEventListener('change', refresh);
  refresh();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button[type=submit]');
    const seriesId = select.value;
    const body = new FormData(form);
    body.delete('series');

    button.disabled = true;
    button.textContent = 'Publishing…';
    try {
      await api(`/api/series/${seriesId}/chapters`, { method: 'POST', body });
      toast('Chapter published.');
      go(`/series/${seriesId}`);
    } catch (err) {
      showError(form.querySelector('#err'), err.message);
      button.disabled = false;
      button.textContent = 'Publish the chapter';
    }
  });
}

function mineList(host, items) {
  host.innerHTML = items.length
    ? `<div class="grid">${items.map((s) => card(s)).join('')}</div>`
    : `<div class="empty"><h2>You have not published anything yet</h2>
        <p>Your series will be listed here once you create one.</p></div>`;
}

/** Shared file-picker behaviour: drag and drop, previews, file ordering. */
function wireDrop(drop, preview, multiple) {
  const input = drop.querySelector('input[type=file]');

  const render = () => {
    const files = [...input.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    preview.innerHTML = files.map((f, i) =>
      `<div class="thumb"><b>${i + 1}</b><img alt="${esc(f.name)}" src="${URL.createObjectURL(f)}"></div>`).join('');
    drop.querySelector('span').textContent = files.length
      ? `${files.length} file${files.length === 1 ? '' : 's'} ready — choose again to replace`
      : multiple ? 'Drop the page images here, or choose files' : 'Drop a cover here, or choose a file';
  };

  input.addEventListener('change', render);
  ['dragenter', 'dragover'].forEach((type) =>
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((type) =>
    drop.addEventListener(type, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const transfer = new DataTransfer();
    [...e.dataTransfer.files]
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, multiple ? 200 : 1)
      .forEach((f) => transfer.items.add(f));
    input.files = transfer.files;
    render();
  });
}

function showError(host, message) {
  host.innerHTML = `<div class="form-error">${esc(message)}</div>`;
  host.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ================================================================ account */

function requireAccount(reason) {
  main().innerHTML = `<div class="wrap"><div class="empty">
    <h2>Sign in first</h2><p>${esc(reason)}</p>
    <p style="margin-top:1.4rem"><a class="btn btn-primary" href="/account" data-link>Go to sign in</a></p>
  </div></div>`;
}

export async function account(query) {
  setTitle('Account');
  if (state.user) {
    main().innerHTML = `<div class="wrap"><h1>Signed in as ${esc(state.user.display_name)}</h1>
      <p class="result-count">@${esc(state.user.username)}</p>
      <div class="series-actions">
        <a class="btn" href="/shelf" data-link>Open your shelf</a>
        <a class="btn" href="/publish" data-link>Publish something</a>
        <button class="btn btn-ghost" id="signout">Sign out</button>
      </div></div>`;
    document.getElementById('signout').addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      state.user = null;
      window.dispatchEvent(new CustomEvent('inkshelf:user'));
      toast('Signed out.');
      go('/');
    });
    return;
  }

  const mode = query.get('mode') === 'register' ? 'register' : 'login';
  main().innerHTML = `<div class="wrap">
    <div class="form">
      <div class="tabs" role="tablist">
        <button role="tab" data-mode="login" aria-selected="${mode === 'login'}">Sign in</button>
        <button role="tab" data-mode="register" aria-selected="${mode === 'register'}">Create an account</button>
      </div>
      <form id="authForm">
        <div id="err"></div>
        <div class="field">
          <label for="a-user">${mode === 'login' ? 'Username or email' : 'Username'}</label>
          <input id="a-user" name="username" type="text" required autocomplete="username">
          ${mode === 'register' ? '<p class="hint">3 to 24 letters, numbers or underscores.</p>' : ''}
        </div>
        ${mode === 'register' ? `<div class="field">
          <label for="a-email">Email</label>
          <input id="a-email" name="email" type="email" required autocomplete="email">
        </div>` : ''}
        <div class="field">
          <label for="a-pass">Password</label>
          <input id="a-pass" name="password" type="password" required minlength="8"
                 autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
          ${mode === 'register' ? '<p class="hint">At least 8 characters.</p>' : ''}
        </div>
        <button class="btn btn-primary" type="submit">${mode === 'login' ? 'Sign in' : 'Create the account'}</button>
      </form>
    </div>
  </div>`;

  main().querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) go(`/account?mode=${b.dataset.mode}`);
  });

  const form = document.getElementById('authForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    const body = Object.fromEntries(new FormData(form));
    try {
      const res = await api(`/api/auth/${mode}`, { method: 'POST', body });
      state.user = res.user;
      window.dispatchEvent(new CustomEvent('inkshelf:user'));
      toast(`Welcome, ${res.user.display_name}.`);
      go('/');
    } catch (err) {
      showError(document.getElementById('err'), err.message);
      button.disabled = false;
    }
  });
}

export function notFound() {
  setTitle('Not found');
  main().innerHTML = `<div class="wrap"><div class="empty">
    <h2>No page here</h2><p>The address does not match anything on the shelf.</p>
    <p><a href="/" data-link>Go back to the front</a></p></div></div>`;
}
