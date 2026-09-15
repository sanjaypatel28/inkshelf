'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'inkshelf.db'));

db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'reader',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS series (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  alt_title    TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL CHECK (kind IN ('manga','manhwa','manhua','novel')),
  status       TEXT NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing','complete','hiatus')),
  synopsis     TEXT NOT NULL DEFAULT '',
  author       TEXT NOT NULL DEFAULT '',
  artist       TEXT NOT NULL DEFAULT '',
  cover_path   TEXT,
  uploader_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reads        INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_series_kind ON series(kind);
CREATE INDEX IF NOT EXISTS idx_series_updated ON series(updated_at DESC);

CREATE TABLE IF NOT EXISTS genres (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS series_genres (
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  genre_id  INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (series_id, genre_id)
);

CREATE TABLE IF NOT EXISTS chapters (
  id         INTEGER PRIMARY KEY,
  series_id  INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  number     REAL NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (series_id, number)
);
CREATE INDEX IF NOT EXISTS idx_chapters_series ON chapters(series_id, number);

CREATE TABLE IF NOT EXISTS pages (
  id         INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  file_path  TEXT NOT NULL,
  UNIQUE (chapter_id, idx)
);

CREATE TABLE IF NOT EXISTS shelf (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id  INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, series_id)
);

CREATE TABLE IF NOT EXISTS progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id  INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  page_idx   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, series_id)
);

CREATE TABLE IF NOT EXISTS ratings (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  score     INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  PRIMARY KEY (user_id, series_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS series_fts USING fts5(
  title, alt_title, people, synopsis, genres,
  series_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
`);

/*
 * Set the ranking weights on the index itself. Doing it here means queries can
 * use the plain `rank` column, which — unlike a bare bm25() call — is legal in
 * grouped and aggregated queries too. Title matches outrank synopsis matches.
 */
try {
  db.prepare(`INSERT INTO series_fts (series_fts, rank) VALUES ('rank', ?)`)
    .run('bm25(10.0, 6.0, 3.0, 1.0, 2.0)');
} catch (err) {
  console.warn('[db] could not set search weights:', err.message);
}

/* ---------------------------------------------------------------- search */

/** Rebuild the search-index row for one series. Call after any write. */
function reindexSeries(seriesId) {
  const row = db.prepare(`SELECT * FROM series WHERE id = ?`).get(seriesId);
  db.prepare(`DELETE FROM series_fts WHERE series_id = ?`).run(seriesId);
  if (!row) return;
  const genres = listGenres(seriesId).join(' ');
  db.prepare(
    `INSERT INTO series_fts (title, alt_title, people, synopsis, genres, series_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.title, row.alt_title, `${row.author} ${row.artist}`.trim(), row.synopsis, genres, seriesId);
}

/**
 * Turn raw user input into a safe FTS5 prefix query.
 * Everything is quoted, so punctuation can never become FTS syntax.
 */
function ftsQuery(raw) {
  const words = String(raw)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `"${w}"*`).join(' AND ');
}

/* ---------------------------------------------------------------- genres */

function listGenres(seriesId) {
  return db
    .prepare(
      `SELECT g.name FROM genres g
       JOIN series_genres sg ON sg.genre_id = g.id
       WHERE sg.series_id = ? ORDER BY g.name`
    )
    .all(seriesId)
    .map((r) => r.name);
}

function setGenres(seriesId, names) {
  db.prepare(`DELETE FROM series_genres WHERE series_id = ?`).run(seriesId);
  const insertGenre = db.prepare(`INSERT OR IGNORE INTO genres (name) VALUES (?)`);
  const findGenre = db.prepare(`SELECT id FROM genres WHERE name = ?`);
  const link = db.prepare(`INSERT OR IGNORE INTO series_genres (series_id, genre_id) VALUES (?, ?)`);
  for (const raw of names) {
    const name = String(raw).trim().slice(0, 40);
    if (!name) continue;
    insertGenre.run(name);
    const g = findGenre.get(name);
    if (g) link.run(seriesId, g.id);
  }
}

function allGenres() {
  return db
    .prepare(
      `SELECT g.name, COUNT(sg.series_id) AS count FROM genres g
       LEFT JOIN series_genres sg ON sg.genre_id = g.id
       GROUP BY g.id HAVING count > 0 ORDER BY count DESC, g.name`
    )
    .all();
}

/* ---------------------------------------------------------------- series */

const SORTS = {
  updated: 's.updated_at DESC',
  newest: 's.created_at DESC',
  reads: 's.reads DESC',
  title: 's.title COLLATE NOCASE ASC',
  rating: 'rating DESC, s.reads DESC',
};

function browseSeries({ q = '', kind = '', genre = '', status = '', sort = 'updated', page = 1, perPage = 24 }) {
  const match = q ? ftsQuery(q) : null;
  if (q && !match) return { items: [], total: 0, page: 1, pages: 1 };

  // Placeholders bind in the order they appear in the SQL text, so join
  // parameters are collected separately from where parameters and concatenated
  // in that same order. Getting this wrong silently swaps filter values.
  const joinParams = [];
  const whereParams = [];
  const where = [];
  let join = '';
  let order = SORTS[sort] || SORTS.updated;

  if (match) {
    // FTS5 rejects an aliased table on the left of MATCH, so the match runs in
    // a subquery and relevance comes back as an ordinary column.
    join += ` JOIN (SELECT series_id, rank AS score FROM series_fts WHERE series_fts MATCH ?) f
              ON f.series_id = s.id`;
    joinParams.push(match);
    if (sort === 'updated') order = 'f.score ASC'; // relevance is the sensible default for a query
  }
  if (genre) {
    join += ` JOIN series_genres sg ON sg.series_id = s.id
              JOIN genres g ON g.id = sg.genre_id AND g.name = ?`;
    joinParams.push(genre);
  }
  if (kind) { where.push('s.kind = ?'); whereParams.push(kind); }
  if (status) { where.push('s.status = ?'); whereParams.push(status); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const params = [...joinParams, ...whereParams];

  const total = db
    .prepare(`SELECT COUNT(DISTINCT s.id) AS n FROM series s ${join} ${whereSql}`)
    .get(...params).n;

  const p = Math.max(1, Number(page) || 1);
  const rows = db
    .prepare(
      `SELECT s.*,
              (SELECT ROUND(AVG(score), 1) FROM ratings r WHERE r.series_id = s.id) AS rating,
              (SELECT COUNT(*) FROM chapters c WHERE c.series_id = s.id) AS chapter_count
       FROM series s ${join} ${whereSql}
       GROUP BY s.id ORDER BY ${order} LIMIT ? OFFSET ?`
    )
    .all(...params, perPage, (p - 1) * perPage);

  return {
    items: rows.map(decorate),
    total,
    page: p,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

function suggest(q, limit = 6) {
  const match = ftsQuery(q);
  if (!match) return [];
  return db
    .prepare(
      `SELECT s.id, s.slug, s.title, s.kind, s.cover_path, s.author
       FROM series s
       JOIN (SELECT series_id, rank AS score FROM series_fts WHERE series_fts MATCH ?) f
         ON f.series_id = s.id
       ORDER BY f.score ASC LIMIT ?`
    )
    .all(match, limit);
}

function decorate(row) {
  if (!row) return null;
  return { ...row, genres: listGenres(row.id), rating: row.rating ?? null };
}

function getSeries(idOrSlug) {
  const row = db
    .prepare(
      `SELECT s.*, u.display_name AS uploader,
              (SELECT ROUND(AVG(score), 1) FROM ratings r WHERE r.series_id = s.id) AS rating,
              (SELECT COUNT(*) FROM ratings r WHERE r.series_id = s.id) AS rating_count,
              (SELECT COUNT(*) FROM chapters c WHERE c.series_id = s.id) AS chapter_count
       FROM series s LEFT JOIN users u ON u.id = s.uploader_id
       WHERE s.slug = ? OR s.id = ?`
    )
    .get(String(idOrSlug), Number(idOrSlug) || -1);
  return decorate(row);
}

function chaptersOf(seriesId) {
  return db
    .prepare(
      `SELECT c.id, c.number, c.title, c.created_at,
              (SELECT COUNT(*) FROM pages p WHERE p.chapter_id = c.id) AS page_count,
              LENGTH(c.body) AS body_length
       FROM chapters c WHERE c.series_id = ? ORDER BY c.number ASC`
    )
    .all(seriesId);
}

function getChapter(id) {
  const chapter = db
    .prepare(
      `SELECT c.*, s.title AS series_title, s.slug AS series_slug, s.kind, s.id AS series_id
       FROM chapters c JOIN series s ON s.id = c.series_id WHERE c.id = ?`
    )
    .get(Number(id));
  if (!chapter) return null;
  chapter.pages = db
    .prepare(`SELECT idx, file_path FROM pages WHERE chapter_id = ? ORDER BY idx`)
    .all(chapter.id);
  const siblings = db
    .prepare(`SELECT id, number, title FROM chapters WHERE series_id = ? ORDER BY number`)
    .all(chapter.series_id);
  const at = siblings.findIndex((c) => c.id === chapter.id);
  chapter.prev = at > 0 ? siblings[at - 1] : null;
  chapter.next = at < siblings.length - 1 ? siblings[at + 1] : null;
  chapter.index = at + 1;
  chapter.total = siblings.length;
  return chapter;
}

function slugify(text, id) {
  const base =
    String(text)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'series';
  let slug = base;
  let n = 2;
  while (true) {
    const clash = db.prepare(`SELECT id FROM series WHERE slug = ?`).get(slug);
    if (!clash || clash.id === id) return slug;
    slug = `${base}-${n++}`;
  }
}

function touchSeries(seriesId) {
  db.prepare(`UPDATE series SET updated_at = datetime('now') WHERE id = ?`).run(seriesId);
}

module.exports = {
  db,
  DATA_DIR,
  UPLOAD_DIR,
  reindexSeries,
  listGenres,
  setGenres,
  allGenres,
  browseSeries,
  suggest,
  getSeries,
  chaptersOf,
  getChapter,
  slugify,
  touchSeries,
  decorate,
};
