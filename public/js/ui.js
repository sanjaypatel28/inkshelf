/* Shared helpers: escaping, fetching, small components. */

/** Every piece of catalogue text passes through here before it reaches innerHTML. */
export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

export async function api(path, options = {}) {
  const init = { credentials: 'same-origin', ...options };
  if (init.body && !(init.body instanceof FormData)) {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(init.body);
  }
  const res = await fetch(path, init);
  let payload = null;
  try { payload = await res.json(); } catch { /* empty body is fine */ }
  if (!res.ok) {
    const err = new Error(payload?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return payload;
}

/** Ask the router for a soft navigation. Kept as an event so ui.js stays
 *  free of any import back into the router. */
export function go(href) {
  window.dispatchEvent(new CustomEvent('inkshelf:navigate', { detail: href }));
}

export function toast(message, tone = 'good') {
  const host = document.getElementById('toasts');
  const node = el(`<div class="toast" data-tone="${tone}">${esc(message)}</div>`);
  host.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 260);
  }, 3200);
}

export const KIND_LABEL = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua', novel: 'Novel' };
export const STATUS_LABEL = { ongoing: 'Ongoing', complete: 'Complete', hiatus: 'On hiatus' };

export const coverUrl = (series) =>
  series.cover_path ? `/uploads/${series.cover_path}` : 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 430"><rect width="300" height="430" fill="#1B1840"/></svg>`);

export function compact(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
}

export function ago(iso) {
  if (!iso) return '';
  const then = new Date(iso.replace(' ', 'T') + 'Z');
  const days = Math.floor((Date.now() - then.getTime()) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/** A catalogue cover with its format badge and one line of metadata. */
export function card(series, extra = '') {
  return `
    <a class="card" href="/series/${esc(series.slug)}" data-link>
      <span class="cover">
        <span class="cover-badge" data-kind="${esc(series.kind)}">${esc(KIND_LABEL[series.kind] || series.kind)}</span>
        <img src="${esc(coverUrl(series))}" alt="Cover of ${esc(series.title)}" loading="lazy" decoding="async">
      </span>
      <span class="card-title">${esc(series.title)}</span>
      <span class="card-meta">
        ${series.chapter_count != null ? `<span>${series.chapter_count} ${series.kind === 'novel' ? 'chapters' : 'chapters'}</span>` : ''}
        ${series.rating ? `<span class="dot-sep">/</span><span>${series.rating.toFixed(1)}</span>` : ''}
      </span>
      ${extra}
    </a>`;
}

export const stars = (value, interactive = false) => {
  const filled = Math.round(Number(value) || 0);
  const shape = 'M10 1.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L10 14.9l-5.2 2.7 1-5.75L1.6 7.75l5.8-.85z';
  return `<span class="stars" role="${interactive ? 'group' : 'img'}" aria-label="${filled} out of 5">` +
    [1, 2, 3, 4, 5].map((n) =>
      `<button type="button" data-score="${n}" data-on="${n <= filled ? 1 : 0}"
        ${interactive ? `aria-label="Rate ${n} out of 5"` : 'tabindex="-1" aria-hidden="true" disabled'}>
        <svg viewBox="0 0 20 20"><path d="${shape}" fill="currentColor"/></svg></button>`).join('') +
    '</span>';
};

export function skeletonGrid(count = 12) {
  return `<div class="grid">${Array.from({ length: count }, () =>
    `<div class="card"><span class="cover skeleton"></span><span class="card-title skeleton" style="height:1.1em"></span></div>`).join('')}</div>`;
}
