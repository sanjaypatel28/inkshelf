'use strict';

/**
 * Fills the database with an original demo catalogue.
 *
 * Everything here is invented for this project: the titles, the blurbs, the
 * prose, and the artwork, which is generated as abstract geometry — no real
 * series, no real characters. Replace it with your own catalogue.
 *
 *   node seed.js          add demo content if the shelf is empty
 *   node seed.js --force  wipe and rebuild the demo content
 */

const fs = require('node:fs');
const path = require('node:path');

const store = require('./lib/db');
const { hashPassword } = require('./lib/auth');
const { db, UPLOAD_DIR } = store;

/* ----------------------------------------------------- deterministic rng */

function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
const between = (r, lo, hi) => lo + r() * (hi - lo);

/* --------------------------------------------------------- abstract art  */

const DUOTONES = [
  ['#131A3A', '#21C7D6'], ['#2A1038', '#F0347F'], ['#0E2A26', '#8BE36B'],
  ['#31170C', '#FFA94A'], ['#101C33', '#7B8CFF'], ['#2B0F1C', '#FF6B6B'],
  ['#15232B', '#4FD1C5'], ['#241634', '#C08BFF'], ['#33240C', '#FFD24A'],
];

/** A halftone dot field — the texture printed comics are made of. */
function halftone(r, id, colour) {
  const step = Math.round(between(r, 7, 12));
  return `<pattern id="${id}" width="${step}" height="${step}" patternUnits="userSpaceOnUse" patternTransform="rotate(${Math.round(between(r, 0, 90))})">
      <circle cx="${step / 2}" cy="${step / 2}" r="${(step * between(r, 0.14, 0.26)).toFixed(2)}" fill="${colour}"/>
    </pattern>`;
}

function coverSvg(title, kind) {
  const r = rng(seedFrom(title + kind));
  const [deep, bright] = DUOTONES[Math.floor(r() * DUOTONES.length)];
  const W = 600, H = 860;
  const shapes = [];

  // A few large overlapping forms, then a horizon band, then dot texture.
  for (let i = 0; i < 4; i++) {
    const kindOfShape = r();
    const cx = between(r, -80, W + 80);
    const cy = between(r, -60, H * 0.8);
    const opacity = between(r, 0.18, 0.5).toFixed(2);
    if (kindOfShape < 0.4) {
      shapes.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${between(r, 120, 330).toFixed(0)}" fill="${bright}" opacity="${opacity}"/>`);
    } else if (kindOfShape < 0.72) {
      const w = between(r, 180, 520), h = between(r, 90, 420);
      shapes.push(`<rect x="${cx.toFixed(0)}" y="${cy.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${bright}" opacity="${opacity}" transform="rotate(${between(r, -28, 28).toFixed(1)} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`);
    } else {
      const x1 = between(r, 0, W), x2 = between(r, 0, W);
      shapes.push(`<polygon points="${x1.toFixed(0)},0 ${x2.toFixed(0)},${H} ${(x2 + between(r, 90, 260)).toFixed(0)},${H} ${(x1 + between(r, 90, 260)).toFixed(0)},0" fill="${bright}" opacity="${opacity}"/>`);
    }
  }

  const horizon = between(r, H * 0.52, H * 0.74);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${deep}"/>
      <stop offset="1" stop-color="#07060F"/>
    </linearGradient>
    ${halftone(r, 'dots', bright)}
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${shapes.join('\n  ')}
  <rect y="${horizon.toFixed(0)}" width="${W}" height="${(H - horizon).toFixed(0)}" fill="url(#dots)" opacity="0.5"/>
  <rect y="${(horizon - 2).toFixed(0)}" width="${W}" height="3" fill="${bright}" opacity="0.8"/>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
</svg>`;
}

/** An abstract comic page: real panel gutters, abstract contents. */
function pageSvg(title, chapter, index) {
  const r = rng(seedFrom(`${title}|${chapter}|${index}`));
  const [deep, bright] = DUOTONES[Math.floor(r() * DUOTONES.length)];
  const W = 900, H = 1300, g = 18, m = 26;
  const panels = [];

  const rows = Math.round(between(r, 2, 4));
  let y = m;
  const usable = H - m * 2 - g * (rows - 1);
  for (let row = 0; row < rows; row++) {
    const h = row === rows - 1 ? H - m - y : usable / rows * between(r, 0.8, 1.2);
    const cols = Math.round(between(r, 1, 3));
    let x = m;
    const colW = (W - m * 2 - g * (cols - 1)) / cols;
    for (let col = 0; col < cols; col++) {
      panels.push({ x, y, w: colW, h: Math.max(80, h), s: r() });
      x += colW + g;
    }
    y += Math.max(80, h) + g;
  }

  const body = panels.map((p, i) => {
    const id = `p${i}`;
    const inner = p.s < 0.34
      ? `<circle cx="${(p.x + p.w * between(r, 0.3, 0.7)).toFixed(0)}" cy="${(p.y + p.h * between(r, 0.3, 0.7)).toFixed(0)}" r="${(Math.min(p.w, p.h) * between(r, 0.18, 0.42)).toFixed(0)}" fill="${bright}" opacity="0.55"/>`
      : p.s < 0.67
        ? `<rect x="${(p.x + p.w * 0.1).toFixed(0)}" y="${(p.y + p.h * 0.55).toFixed(0)}" width="${(p.w * 0.8).toFixed(0)}" height="${(p.h * 0.4).toFixed(0)}" fill="${bright}" opacity="0.35"/>`
        : Array.from({ length: 9 }, (_, k) =>
            `<line x1="${(p.x + p.w / 2).toFixed(0)}" y1="${(p.y + p.h / 2).toFixed(0)}" x2="${(p.x + p.w * (k % 3) / 2).toFixed(0)}" y2="${(p.y + p.h * Math.floor(k / 3) / 2).toFixed(0)}" stroke="${bright}" stroke-width="2" opacity="0.4"/>`
          ).join('');
    return `<g clip-path="url(#clip${i})">
      <rect x="${p.x.toFixed(0)}" y="${p.y.toFixed(0)}" width="${p.w.toFixed(0)}" height="${p.h.toFixed(0)}" fill="${deep}"/>
      <rect x="${p.x.toFixed(0)}" y="${p.y.toFixed(0)}" width="${p.w.toFixed(0)}" height="${p.h.toFixed(0)}" fill="url(#tone)" opacity="0.4"/>
      ${inner}
    </g>
    <rect x="${p.x.toFixed(0)}" y="${p.y.toFixed(0)}" width="${p.w.toFixed(0)}" height="${p.h.toFixed(0)}" fill="none" stroke="#0B0A14" stroke-width="3"/>`;
  }).join('\n  ');

  const clips = panels.map((p, i) =>
    `<clipPath id="clip${i}"><rect x="${p.x.toFixed(0)}" y="${p.y.toFixed(0)}" width="${p.w.toFixed(0)}" height="${p.h.toFixed(0)}"/></clipPath>`
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>${clips}${halftone(r, 'tone', bright)}</defs>
  <rect width="${W}" height="${H}" fill="#EDE7DA"/>
  ${body}
  <text x="${W - m}" y="${H - 8}" text-anchor="end" font-family="monospace" font-size="15" fill="#8A8374">${index + 1}</text>
</svg>`;
}

function writeArt(svg, name) {
  const shard = (seedFrom(name) % 256).toString(16).padStart(2, '0');
  const dir = path.join(UPLOAD_DIR, shard);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 48)}.svg`;
  fs.writeFileSync(path.join(dir, file), svg);
  return `${shard}/${file}`;
}

/* ----------------------------------------------------------- the catalogue */

const CATALOGUE = [
  { title: 'Ashfall Cartographers', kind: 'manga', status: 'ongoing', author: 'Rin Odaka',
    genres: ['Adventure', 'Fantasy', 'Drama'],
    synopsis: 'Volcanic ash has swallowed every road on the continent, so the maps are all wrong and the people who redraw them are worth more than gold. Sena signs on as an apprentice to the least popular cartographer in the guild, mostly because he is the only one still willing to walk into the grey.' },
  { title: 'The Quiet Between Trains', kind: 'manga', status: 'complete', author: 'Mika Serizawa',
    genres: ['Slice of Life', 'Romance'],
    synopsis: 'Two night-shift workers share the same platform for eleven minutes every evening and have never spoken. A chapter for each week of one year, told almost entirely in the gaps.' },
  { title: 'Ninth Bell Country', kind: 'manga', status: 'ongoing', author: 'Haru Nishimoto',
    genres: ['Mystery', 'Supernatural', 'Historical'],
    synopsis: 'In a coastal town where the temple bell is rung nine times for a death, it has rung ten. The tenth ring belongs to someone who has not died yet, and the town has one season to work out who.' },
  { title: 'Iron Orchard', kind: 'manga', status: 'hiatus', author: 'Kaede Toriyama',
    genres: ['Action', 'Sci-Fi'],
    synopsis: 'The orchard grows machine parts instead of fruit, and nobody remembers planting it. A salvage crew moves in for one harvest and finds the trees have opinions about who does the picking.' },

  { title: 'Paper Crown Dynasty', kind: 'manhwa', status: 'ongoing', author: 'Seo Da-eun',
    genres: ['Fantasy', 'Drama', 'Romance'],
    synopsis: 'A forger of royal seals is arrested, then immediately promoted: the palace needs someone who can imitate a king well enough to keep a war from starting. She has three months before anyone who knew his handwriting returns from the front.' },
  { title: 'Rooftop Gravity', kind: 'manhwa', status: 'ongoing', author: 'Lim Hyun-woo',
    genres: ['Action', 'Supernatural', 'Thriller'],
    synopsis: 'Gravity failed for four seconds across one city block, and everyone inside it came back able to fall upward. Eight years later they are being collected, one by one, by people who were not there.' },
  { title: 'Soft Armour', kind: 'manhwa', status: 'ongoing', author: 'Jung Mirae',
    genres: ['Romance', 'Slice of Life', 'Comedy'],
    synopsis: 'A retired bodyguard opens a knitting shop next to the precinct she used to work with. Her old colleagues keep finding excuses to come in, and none of them are about yarn.' },
  { title: 'The Understudy King', kind: 'manhwa', status: 'complete', author: 'Baek Su-jin',
    genres: ['Fantasy', 'Psychological', 'Drama'],
    synopsis: 'Every monarch keeps a double trained to die in their place. This one has been the double for thirty years and has never once been needed, which he is starting to find insulting.' },

  { title: 'Lantern Ledger', kind: 'manhua', status: 'ongoing', author: 'Wen Jiaxi',
    genres: ['Martial Arts', 'Mystery', 'Historical'],
    synopsis: 'A bookkeeper for a canal town discovers the accounts balance perfectly only if eleven people who live there do not exist. Asking about it gets her a sword lesson she did not sign up for.' },
  { title: 'Cloudroot Sect', kind: 'manhua', status: 'ongoing', author: 'Lu Hanwei',
    genres: ['Cultivation', 'Adventure', 'Comedy'],
    synopsis: 'The smallest cultivation sect on the mountain has nine disciples, one technique, and a mortgage. Their new recruit is very strong and very bad at explaining where he came from.' },
  { title: 'Riverbone', kind: 'manhua', status: 'hiatus', author: 'Tang Yueying',
    genres: ['Horror', 'Supernatural'],
    synopsis: 'The river gives back everything it takes, eventually, and not always in the same shape. A village funeral director keeps a private list of what has come home wrong.' },

  { title: 'Salt and Signal', kind: 'novel', status: 'ongoing', author: 'Idris Oyelaran',
    genres: ['Sci-Fi', 'Mystery'],
    synopsis: 'A radio operator on a decommissioned weather platform in the North Atlantic starts receiving a broadcast that describes her own day, six hours before it happens. It is accurate until the morning it is not.' },
  { title: 'The Long Apprenticeship', kind: 'novel', status: 'ongoing', author: 'Farah Nasrallah',
    genres: ['Fantasy', 'Drama'],
    synopsis: 'Magic in this country is taught the way a trade is: seven years, one master, no shortcuts. Yusra is in year nine, and her master has stopped answering the question of why.' },
  { title: 'Housekeeping for Ghosts', kind: 'novel', status: 'complete', author: 'Priya Rajagopal',
    genres: ['Supernatural', 'Slice of Life', 'Comedy'],
    synopsis: 'A cleaning service that specialises in properties where something lingers. Twelve jobs, twelve houses, and one client who keeps booking the same empty flat.' },
  { title: 'Winter Term at Aldgate', kind: 'novel', status: 'ongoing', author: 'Cormac Whitfield',
    genres: ['Mystery', 'Psychological', 'Thriller'],
    synopsis: 'A boarding school reopens after a fire with two fewer students than the register admits. The new head of house is the only person who seems to have noticed, which is exactly why she was hired.' },
];

/* --------------------------------------------------- original demo prose */

const OPENERS = [
  'The cold got in through the window frame before anyone thought to fix it.',
  'Nobody had used the east stair in years, which was the whole reason to use it now.',
  'It started with a sound that could have been the building settling.',
  'The message arrived without a sender, which was not unusual, and without a time stamp, which was.',
  'She counted the lamps on the way down and got a different number each time.',
  'Rain had been falling long enough that the sound had stopped registering as rain.',
  'The ledger was open to a page that had not been written yet.',
  'Everyone agreed afterwards that the morning had been ordinary.',
];

const MIDDLES = [
  'There was a procedure for this, written down somewhere, and no time to go and find it.',
  'The habit of not asking had been learned early and held up well under pressure.',
  'Three things were true at once, and only one of them was convenient.',
  'What followed took four minutes and would be argued about for years.',
  'It was the sort of answer that only makes sense if you already know the question.',
  'The room did not change. The way it was being looked at did.',
  'A decision made quietly at that moment turned out to matter more than the loud ones.',
  'Somewhere below, a door closed with the particular softness of someone trying not to be heard.',
  'The explanation offered was true in every detail and entirely misleading.',
  'Old arrangements have a way of holding until precisely the moment they are needed.',
];

const CLOSERS = [
  'By the time the light changed, the decision had already been made for her.',
  'That was the end of the easy part.',
  'Nothing was resolved, but the shape of it was clearer.',
  'He went back the long way, and took his time about it.',
  'The next morning, the count was right again. Nobody mentioned it.',
  'It would be another week before the second letter arrived.',
];

function prose(title, chapter) {
  const r = rng(seedFrom(`${title}#${chapter}`));
  const paragraphs = [];
  const count = Math.round(between(r, 6, 10));
  for (let i = 0; i < count; i++) {
    const lines = [];
    if (i === 0) lines.push(pick(r, OPENERS));
    const sentences = Math.round(between(r, 2, 4));
    for (let s = 0; s < sentences; s++) lines.push(pick(r, MIDDLES));
    if (i === count - 1) lines.push(pick(r, CLOSERS));
    paragraphs.push(lines.join(' '));
  }
  return paragraphs.join('\n\n');
}

/* ------------------------------------------------------------------ run  */

const force = process.argv.includes('--force');
const existing = db.prepare(`SELECT COUNT(*) AS n FROM series`).get().n;

if (existing > 0 && !force) {
  console.log(`Shelf already holds ${existing} series. Use "node seed.js --force" to rebuild the demo content.`);
  process.exit(0);
}

if (force) {
  db.exec(`DELETE FROM series; DELETE FROM series_fts; DELETE FROM genres;`);
  console.log('Cleared existing catalogue.');
}

let demoUser = db.prepare(`SELECT id FROM users WHERE username = 'inkshelf'`).get();
if (!demoUser) {
  const info = db
    .prepare(`INSERT INTO users (username, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)`)
    .run('inkshelf', 'demo@inkshelf.local', hashPassword('readmore123'), 'Inkshelf Editorial', 'admin');
  demoUser = { id: Number(info.lastInsertRowid) };
}

const insertSeries = db.prepare(
  `INSERT INTO series (slug, title, kind, status, synopsis, author, artist, cover_path, uploader_id, reads, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`
);
const insertChapter = db.prepare(`INSERT INTO chapters (series_id, number, title, body, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))`);
const insertPage = db.prepare(`INSERT INTO pages (chapter_id, idx, file_path) VALUES (?, ?, ?)`);

let pageCount = 0;

for (const entry of CATALOGUE) {
  const r = rng(seedFrom(entry.title));
  const cover = writeArt(coverSvg(entry.title, entry.kind), `cover-${entry.title}`);
  const age = -Math.round(between(r, 20, 400));

  const info = insertSeries.run(
    'tmp-' + entry.title.toLowerCase().replace(/\W+/g, '-'),
    entry.title, entry.kind, entry.status, entry.synopsis,
    entry.author, entry.kind === 'novel' ? '' : entry.author,
    cover, demoUser.id, Math.round(between(r, 400, 96000)),
    `${age} days`, `-${Math.round(between(r, 0, 9))} days`
  );
  const seriesId = Number(info.lastInsertRowid);
  db.prepare(`UPDATE series SET slug = ? WHERE id = ?`).run(store.slugify(entry.title, seriesId), seriesId);
  store.setGenres(seriesId, entry.genres);
  store.reindexSeries(seriesId);

  const chapters = Math.round(between(r, 4, 9));
  for (let n = 1; n <= chapters; n++) {
    const isNovel = entry.kind === 'novel';
    const chapterInfo = insertChapter.run(
      seriesId, n,
      isNovel ? `Chapter ${n}` : '',
      isNovel ? prose(entry.title, n) : '',
      `${age + n * 3} days`
    );
    if (!isNovel) {
      const chapterId = Number(chapterInfo.lastInsertRowid);
      const pages = Math.round(between(r, 5, 9));
      for (let p = 0; p < pages; p++) {
        insertPage.run(chapterId, p, writeArt(pageSvg(entry.title, n, p), `page-${entry.title}-${n}-${p}`));
        pageCount++;
      }
    }
  }
}

// A spread of ratings so the sort-by-rating view has something to sort.
const raters = [];
for (let i = 1; i <= 12; i++) {
  let u = db.prepare(`SELECT id FROM users WHERE username = ?`).get(`reader_${i}`);
  if (!u) {
    const info = db
      .prepare(`INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)`)
      .run(`reader_${i}`, `reader_${i}@inkshelf.local`, hashPassword(`demo-pass-${i}`), `Reader ${i}`);
    u = { id: Number(info.lastInsertRowid) };
  }
  raters.push(u.id);
}
const rate = db.prepare(`INSERT OR REPLACE INTO ratings (user_id, series_id, score) VALUES (?, ?, ?)`);
for (const s of db.prepare(`SELECT id, title FROM series`).all()) {
  const r = rng(seedFrom('rating' + s.title));
  for (const uid of raters) {
    if (r() < 0.65) rate.run(uid, s.id, Math.max(1, Math.min(5, Math.round(between(r, 2.6, 5.4)))));
  }
}

const totals = db.prepare(`SELECT (SELECT COUNT(*) FROM series) s, (SELECT COUNT(*) FROM chapters) c`).get();
console.log(`Seeded ${totals.s} series, ${totals.c} chapters, ${pageCount} generated pages.`);
console.log(`Demo publisher account: inkshelf / readmore123`);
