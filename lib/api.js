'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const store = require('./db');
const auth = require('./auth');
const multipart = require('./multipart');

const { db, UPLOAD_DIR } = store;

const MAX_BODY = 64 * 1024 * 1024; // 64 MB per request
const MAX_PAGES = 200;
const KINDS = new Set(['manga', 'manhwa', 'manhua', 'novel']);
const STATUSES = new Set(['ongoing', 'complete', 'hiatus']);

/* ------------------------------------------------------------- utilities */

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function json(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'That upload is larger than the 64 MB limit.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req, 1024 * 512);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'The request body was not valid JSON.');
  }
}

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Sign in to do that.');
  return ctx.user;
}

function str(value, { max = 500, field = 'field', required = false } = {}) {
  const out = String(value ?? '').trim();
  if (required && !out) throw new HttpError(400, `${field} is required.`);
  if (out.length > max) throw new HttpError(400, `${field} must be under ${max} characters.`);
  return out;
}

/* ---------------------------------------------------------- file storage */

const IMAGE_SIGNATURES = [
  { ext: '.jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', type: 'image/png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.gif', type: 'image/gif', test: (b) => b.slice(0, 3).toString() === 'GIF' },
  { ext: '.webp', type: 'image/webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
  { ext: '.avif', type: 'image/avif', test: (b) => b.slice(4, 8).toString() === 'ftyp' && b.slice(8, 12).toString().startsWith('avif') },
];

/** Identify by magic bytes, never by the filename the browser sent. */
function sniffImage(buffer) {
  if (!buffer || buffer.length < 16) return null;
  return IMAGE_SIGNATURES.find((sig) => sig.test(buffer)) || null;
}

/** Content-addressed storage: identical files are stored once. */
function storeImage(buffer, label = 'image') {
  const sig = sniffImage(buffer);
  if (!sig) {
    throw new HttpError(415, `${label} must be a JPEG, PNG, WebP, AVIF or GIF image.`);
  }
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const shard = hash.slice(0, 2);
  const name = `${hash.slice(2, 26)}${sig.ext}`;
  const dir = path.join(UPLOAD_DIR, shard);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, name);
  if (!fs.existsSync(full)) fs.writeFileSync(full, buffer);
  return `${shard}/${name}`;
}

/* --------------------------------------------------------------- reading */

function homePayload(user) {
  const spotlight = store.browseSeries({ sort: 'reads', perPage: 7 }).items;
  const rails = [
    { id: 'fresh', title: 'Updated this week', items: store.browseSeries({ sort: 'updated', perPage: 12 }).items },
    { id: 'manhwa', title: 'Vertical scroll', items: store.browseSeries({ kind: 'manhwa', perPage: 12 }).items },
    { id: 'manga', title: 'Right to left', items: store.browseSeries({ kind: 'manga', perPage: 12 }).items },
    { id: 'novel', title: 'Prose', items: store.browseSeries({ kind: 'novel', perPage: 12 }).items },
  ].filter((rail) => rail.items.length > 0);

  let continueReading = [];
  if (user) {
    continueReading = db
      .prepare(
        `SELECT p.page_idx, p.updated_at, p.chapter_id, c.number AS chapter_number, c.title AS chapter_title,
                s.id, s.slug, s.title, s.kind, s.cover_path,
                (SELECT COUNT(*) FROM chapters cc WHERE cc.series_id = s.id) AS chapter_count
         FROM progress p
         JOIN series s ON s.id = p.series_id
         JOIN chapters c ON c.id = p.chapter_id
         WHERE p.user_id = ? ORDER BY p.updated_at DESC LIMIT 8`
      )
      .all(user.id);
  }
  return { spotlight, rails, continueReading, genres: store.allGenres().slice(0, 18) };
}

/* ---------------------------------------------------------------- routes */

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:([A-Za-z]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; }) + '$'
  );
  routes.push({ method, regex, keys, handler });
};

/* --- auth --- */

route('POST', '/api/auth/register', async (ctx) => {
  const body = await readJson(ctx.req);
  const username = str(body.username, { max: 24, field: 'Username', required: true });
  const email = str(body.email, { max: 160, field: 'Email', required: true });
  const password = String(body.password ?? '');

  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    throw new HttpError(400, 'Usernames use 3–24 letters, numbers or underscores.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'That email address looks incomplete.');
  if (password.length < 8) throw new HttpError(400, 'Passwords need at least 8 characters.');

  if (db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username)) {
    throw new HttpError(409, 'That username is taken.');
  }
  if (db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(email)) {
    throw new HttpError(409, 'An account already uses that email.');
  }

  const info = db
    .prepare(`INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)`)
    .run(username, email, auth.hashPassword(password), username);

  const session = auth.createSession(Number(info.lastInsertRowid));
  const user = db.prepare(`SELECT id, username, display_name, role FROM users WHERE id = ?`).get(Number(info.lastInsertRowid));
  json(ctx.res, 201, { user }, { 'Set-Cookie': auth.sessionCookie(session) });
});

route('POST', '/api/auth/login', async (ctx) => {
  const body = await readJson(ctx.req);
  const identifier = str(body.username, { max: 160, field: 'Username', required: true });
  const row = db.prepare(`SELECT * FROM users WHERE username = ? OR email = ?`).get(identifier, identifier);

  if (!row || !auth.verifyPassword(String(body.password ?? ''), row.password_hash)) {
    throw new HttpError(401, 'That username and password do not match.');
  }
  const session = auth.createSession(row.id);
  json(
    ctx.res, 200,
    { user: { id: row.id, username: row.username, display_name: row.display_name, role: row.role } },
    { 'Set-Cookie': auth.sessionCookie(session) }
  );
});

route('POST', '/api/auth/logout', async (ctx) => {
  if (ctx.user) auth.destroySession(ctx.user._token);
  json(ctx.res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
});

route('GET', '/api/auth/me', async (ctx) => {
  json(ctx.res, 200, { user: ctx.user ? { id: ctx.user.id, username: ctx.user.username, display_name: ctx.user.display_name, role: ctx.user.role } : null });
});

/* --- discovery --- */

route('GET', '/api/home', async (ctx) => json(ctx.res, 200, homePayload(ctx.user)));

route('GET', '/api/genres', async (ctx) => json(ctx.res, 200, { genres: store.allGenres() }));

route('GET', '/api/suggest', async (ctx) => {
  json(ctx.res, 200, { results: store.suggest(ctx.query.get('q') || '', 7) });
});

route('GET', '/api/series', async (ctx) => {
  const q = ctx.query;
  const kind = q.get('kind') || '';
  if (kind && !KINDS.has(kind)) throw new HttpError(400, 'Unknown format filter.');
  const result = store.browseSeries({
    q: q.get('q') || '',
    kind,
    genre: q.get('genre') || '',
    status: STATUSES.has(q.get('status')) ? q.get('status') : '',
    sort: q.get('sort') || 'updated',
    page: Number(q.get('page')) || 1,
    perPage: Math.min(48, Math.max(6, Number(q.get('perPage')) || 24)),
  });
  json(ctx.res, 200, result);
});

route('GET', '/api/series/:key', async (ctx) => {
  const series = store.getSeries(ctx.params.key);
  if (!series) throw new HttpError(404, 'No series with that address.');
  const chapters = store.chaptersOf(series.id);
  let shelved = false;
  let myRating = null;
  let progress = null;
  if (ctx.user) {
    shelved = !!db.prepare(`SELECT 1 FROM shelf WHERE user_id = ? AND series_id = ?`).get(ctx.user.id, series.id);
    myRating = db.prepare(`SELECT score FROM ratings WHERE user_id = ? AND series_id = ?`).get(ctx.user.id, series.id)?.score ?? null;
    progress = db.prepare(`SELECT chapter_id, page_idx FROM progress WHERE user_id = ? AND series_id = ?`).get(ctx.user.id, series.id) ?? null;
  }
  json(ctx.res, 200, { series, chapters, shelved, myRating, progress, owned: !!ctx.user && ctx.user.id === series.uploader_id });
});

route('GET', '/api/chapters/:id', async (ctx) => {
  const chapter = store.getChapter(ctx.params.id);
  if (!chapter) throw new HttpError(404, 'That chapter is not here.');
  db.prepare(`UPDATE series SET reads = reads + 1 WHERE id = ?`).run(chapter.series_id);
  json(ctx.res, 200, { chapter });
});

/* --- publishing --- */

route('POST', '/api/series', async (ctx) => {
  const user = requireUser(ctx);
  const raw = await readBody(ctx.req);
  const { fields, files } = multipart.parse(raw, ctx.req.headers['content-type']);

  const title = str(fields.title, { max: 160, field: 'Title', required: true });
  const kind = str(fields.kind, { max: 12, field: 'Format', required: true });
  if (!KINDS.has(kind)) throw new HttpError(400, 'Pick one of: manga, manhwa, manhua, novel.');
  const status = STATUSES.has(fields.status) ? fields.status : 'ongoing';

  const cover = files.find((f) => f.field === 'cover');
  const coverPath = cover ? storeImage(cover.data, 'The cover') : null;

  const info = db
    .prepare(
      `INSERT INTO series (slug, title, alt_title, kind, status, synopsis, author, artist, cover_path, uploader_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'pending-' + crypto.randomUUID(),
      title,
      str(fields.alt_title, { max: 160, field: 'Alternative title' }),
      kind,
      status,
      str(fields.synopsis, { max: 4000, field: 'Synopsis' }),
      str(fields.author, { max: 120, field: 'Author' }) || user.display_name,
      str(fields.artist, { max: 120, field: 'Artist' }),
      coverPath,
      user.id
    );

  const id = Number(info.lastInsertRowid);
  db.prepare(`UPDATE series SET slug = ? WHERE id = ?`).run(store.slugify(title, id), id);
  store.setGenres(id, String(fields.genres ?? '').split(',').map((g) => g.trim()).filter(Boolean).slice(0, 10));
  store.reindexSeries(id);

  json(ctx.res, 201, { series: store.getSeries(id) });
});

route('POST', '/api/series/:id/chapters', async (ctx) => {
  const user = requireUser(ctx);
  const series = store.getSeries(ctx.params.id);
  if (!series) throw new HttpError(404, 'No series with that address.');
  if (series.uploader_id !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'Only the person who published a series can add chapters to it.');
  }

  const raw = await readBody(ctx.req);
  const { fields, files } = multipart.parse(raw, ctx.req.headers['content-type']);

  const number = Number(fields.number);
  if (!Number.isFinite(number) || number < 0) throw new HttpError(400, 'Chapter number must be a positive number.');
  if (db.prepare(`SELECT 1 FROM chapters WHERE series_id = ? AND number = ?`).get(series.id, number)) {
    throw new HttpError(409, `Chapter ${number} already exists in this series.`);
  }

  const title = str(fields.title, { max: 200, field: 'Chapter title' });
  const body = str(fields.body, { max: 400000, field: 'Chapter text' });
  const pageFiles = files.filter((f) => f.field === 'pages');

  if (series.kind === 'novel') {
    if (!body) throw new HttpError(400, 'A novel chapter needs its text.');
  } else if (!pageFiles.length) {
    throw new HttpError(400, 'A comic chapter needs at least one page image.');
  }
  if (pageFiles.length > MAX_PAGES) throw new HttpError(400, `Chapters hold up to ${MAX_PAGES} pages.`);

  // Store every page before touching the database so a bad file cannot leave a half-built chapter.
  const stored = pageFiles.map((file, i) => storeImage(file.data, `Page ${i + 1}`));

  const info = db
    .prepare(`INSERT INTO chapters (series_id, number, title, body) VALUES (?, ?, ?, ?)`)
    .run(series.id, number, title, series.kind === 'novel' ? body : '');
  const chapterId = Number(info.lastInsertRowid);

  const insertPage = db.prepare(`INSERT INTO pages (chapter_id, idx, file_path) VALUES (?, ?, ?)`);
  stored.forEach((filePath, i) => insertPage.run(chapterId, i, filePath));

  store.touchSeries(series.id);
  json(ctx.res, 201, { chapter: store.getChapter(chapterId) });
});

route('DELETE', '/api/series/:id', async (ctx) => {
  const user = requireUser(ctx);
  const series = store.getSeries(ctx.params.id);
  if (!series) throw new HttpError(404, 'No series with that address.');
  if (series.uploader_id !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'Only the person who published a series can remove it.');
  }
  db.prepare(`DELETE FROM series WHERE id = ?`).run(series.id);
  db.prepare(`DELETE FROM series_fts WHERE series_id = ?`).run(series.id);
  json(ctx.res, 200, { ok: true });
});

route('GET', '/api/mine', async (ctx) => {
  const user = requireUser(ctx);
  const items = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM chapters c WHERE c.series_id = s.id) AS chapter_count
       FROM series s WHERE s.uploader_id = ? ORDER BY s.updated_at DESC`
    )
    .all(user.id)
    .map(store.decorate);
  json(ctx.res, 200, { items });
});

/* --- reader state --- */

route('POST', '/api/shelf/:id', async (ctx) => {
  const user = requireUser(ctx);
  const series = store.getSeries(ctx.params.id);
  if (!series) throw new HttpError(404, 'No series with that address.');
  const existing = db.prepare(`SELECT 1 FROM shelf WHERE user_id = ? AND series_id = ?`).get(user.id, series.id);
  if (existing) {
    db.prepare(`DELETE FROM shelf WHERE user_id = ? AND series_id = ?`).run(user.id, series.id);
  } else {
    db.prepare(`INSERT INTO shelf (user_id, series_id) VALUES (?, ?)`).run(user.id, series.id);
  }
  json(ctx.res, 200, { shelved: !existing });
});

route('GET', '/api/shelf', async (ctx) => {
  const user = requireUser(ctx);
  const items = db
    .prepare(
      `SELECT s.*, sh.created_at AS added_at,
              (SELECT COUNT(*) FROM chapters c WHERE c.series_id = s.id) AS chapter_count,
              (SELECT chapter_id FROM progress p WHERE p.user_id = sh.user_id AND p.series_id = s.id) AS last_chapter_id
       FROM shelf sh JOIN series s ON s.id = sh.series_id
       WHERE sh.user_id = ? ORDER BY sh.created_at DESC`
    )
    .all(user.id)
    .map(store.decorate);
  json(ctx.res, 200, { items });
});

route('POST', '/api/progress', async (ctx) => {
  const user = requireUser(ctx);
  const body = await readJson(ctx.req);
  const chapter = store.getChapter(body.chapterId);
  if (!chapter) throw new HttpError(404, 'That chapter is not here.');
  db.prepare(
    `INSERT INTO progress (user_id, series_id, chapter_id, page_idx, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, series_id) DO UPDATE SET
       chapter_id = excluded.chapter_id, page_idx = excluded.page_idx, updated_at = excluded.updated_at`
  ).run(user.id, chapter.series_id, chapter.id, Math.max(0, Number(body.page) || 0));
  json(ctx.res, 200, { ok: true });
});

route('POST', '/api/rate/:id', async (ctx) => {
  const user = requireUser(ctx);
  const series = store.getSeries(ctx.params.id);
  if (!series) throw new HttpError(404, 'No series with that address.');
  const body = await readJson(ctx.req);
  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new HttpError(400, 'Ratings run from 1 to 5.');
  db.prepare(
    `INSERT INTO ratings (user_id, series_id, score) VALUES (?, ?, ?)
     ON CONFLICT(user_id, series_id) DO UPDATE SET score = excluded.score`
  ).run(user.id, series.id, score);
  json(ctx.res, 200, { rating: store.getSeries(series.id).rating, myRating: score });
});

/* -------------------------------------------------------------- dispatch */

async function handle(req, res, url) {
  const ctx = {
    req, res,
    query: url.searchParams,
    params: {},
    user: auth.userFromRequest(req),
  };

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = r.regex.exec(url.pathname);
    if (!match) continue;
    r.keys.forEach((key, i) => { ctx.params[key] = decodeURIComponent(match[i + 1]); });
    try {
      await r.handler(ctx);
    } catch (err) {
      if (res.headersSent) return true;
      if (err instanceof HttpError) {
        json(res, err.status, { error: err.message, details: err.details });
      } else {
        console.error('[api]', url.pathname, err);
        json(res, 500, { error: 'Something broke on our side. Try that again.' });
      }
    }
    return true;
  }
  return false;
}

module.exports = { handle, storeImage, HttpError };
