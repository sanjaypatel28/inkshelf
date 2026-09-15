# Inkshelf

A reading and publishing platform for comics and web novels. Readers browse,
search, save and read; creators upload series and chapters.

Each of the four formats is read the way it is meant to be read:

| Format | Reader |
|---|---|
| Manhwa, manhua | One continuous vertical strip, pages butted edge to edge |
| Manga | Paged, right to left, two-page spreads on wide screens |
| Novel | Prose with reader-controlled text size and page colour |

## Running it

Node 22.5 or newer. Nothing to install — no dependencies at all.

```bash
node seed.js     # fills the shelf with demo content
node server.js   # http://127.0.0.1:4173
```

The demo publisher account is `inkshelf` / `readmore123`. Sign in as that, or
create your own account, to upload.

`npm run reset` throws away the database and uploads and starts over.

## What's in the box

```
server.js          HTTP server, static files, SPA fallback
lib/db.js          SQLite schema, full-text search index, queries
lib/auth.js        scrypt password hashing, cookie sessions
lib/multipart.js   multipart/form-data parser
lib/api.js         every REST endpoint
seed.js            demo catalogue and generated artwork
public/            the single-page front end
data/              database and uploaded files (created on first run)
```

Storage is SQLite through Node's built-in `node:sqlite`. Uploads are written to
`data/uploads/` under a hash of their contents, so the same file uploaded twice
is stored once.

## Search

Search runs on SQLite FTS5 across title, alternative title, author, artist,
synopsis and genres, with title matches weighted highest. Every word becomes a
quoted prefix term, so a half-typed query still matches and punctuation can
never be read as query syntax.

The box in the header suggests as you type (debounced, with arrow-key
selection); Enter runs a full search with format, status, genre and sort
filters that all live in the URL and survive a reload or a shared link.

## API

```
POST   /api/auth/register          {username, email, password}
POST   /api/auth/login             {username, password}
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/home                   spotlight, rails, continue-reading
GET    /api/series                 ?q= &kind= &genre= &status= &sort= &page=
GET    /api/series/:idOrSlug       series, chapters, your shelf/rating state
GET    /api/suggest                ?q=            typeahead
GET    /api/genres
GET    /api/chapters/:id           pages or text, plus prev/next

POST   /api/series                 multipart: fields + cover      (signed in)
POST   /api/series/:id/chapters    multipart: pages[] or body     (owner)
DELETE /api/series/:id                                            (owner)
GET    /api/mine                                                  (signed in)

POST   /api/shelf/:id              toggle                         (signed in)
GET    /api/shelf                                                 (signed in)
POST   /api/progress               {chapterId, page}              (signed in)
POST   /api/rate/:id               {score 1-5}                    (signed in)
```

## Security notes

- Passwords are hashed with scrypt and compared in constant time.
- Sessions are httpOnly, SameSite=Lax cookies with a server-side expiry sweep.
- Uploads are identified by magic bytes, never by the filename the browser
  claims, and are served with `nosniff` and a sandbox CSP so a file can never
  execute as a document.
- Static paths are resolved and checked against their root, so `..` cannot walk
  out of the public or uploads directories.
- Every database call is a bound parameter; search terms are quoted before they
  reach FTS5.
- All catalogue text is escaped on the way into the DOM.

Before putting this on the public internet you still want: HTTPS in front of
it, a CSRF token on the state-changing endpoints, rate limiting on login and
upload, email verification, and a moderation queue.

## Content

Everything in the seed — titles, blurbs, prose and artwork — was made up for
this project. The covers and pages are generated as abstract geometry from a
hash of each title, so no two look alike and none of it depicts anyone else's
work. Replace `CATALOGUE` in `seed.js` with your own, or delete the demo data
entirely with `npm run reset`.

The platform is built for work you own or have permission to publish. If you
open it to other people, the moderation queue is not optional.
