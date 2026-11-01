-- Video Review: cuts and graphics reviewed Frame.io-style. Originals live in R2 (review/orig/<version id>);
-- videos also stream from Cloudflare Stream until they're archived to save stored minutes.
CREATE TABLE review_reviews (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  folder      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'in-progress',
  request_id  TEXT,
  keep        INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL,
  created_by_email TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX review_reviews_request ON review_reviews (request_id);

CREATE TABLE review_versions (
  id           TEXT PRIMARY KEY,
  review_id    TEXT NOT NULL,
  n            INTEGER NOT NULL,
  kind         TEXT NOT NULL,              -- video | image
  name         TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  duration     REAL NOT NULL DEFAULT 0,
  fps          REAL NOT NULL DEFAULT 30,
  width        INTEGER NOT NULL DEFAULT 0,
  height       INTEGER NOT NULL DEFAULT 0,
  state        TEXT NOT NULL DEFAULT 'ready', -- processing | ready | error
  error        TEXT NOT NULL DEFAULT '',
  stream_uid   TEXT NOT NULL DEFAULT '',
  hls          TEXT NOT NULL DEFAULT '',
  has_thumb    INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  restored_at  TEXT,
  stream_delete_at TEXT,                    -- the date Cloudflare will delete it on its own (backstop)
  warned_at    TEXT,                        -- uploader told it's leaving Stream soon
  checked_at   TEXT,                        -- last time Stream was asked how processing is going
  uploaded_by  TEXT NOT NULL,
  uploaded_by_email TEXT NOT NULL DEFAULT '',
  at           TEXT NOT NULL
);
CREATE INDEX review_versions_review ON review_versions (review_id);

CREATE TABLE review_comments (
  id          TEXT PRIMARY KEY,
  review_id   TEXT NOT NULL,
  version_id  TEXT NOT NULL,
  parent_id   TEXT,
  author      TEXT NOT NULL,
  author_email TEXT NOT NULL DEFAULT '',
  guest       INTEGER NOT NULL DEFAULT 0,
  body        TEXT NOT NULL DEFAULT '',
  t           REAL,
  t_end       REAL,
  pin         TEXT,                          -- JSON [x,y]
  drawing     TEXT NOT NULL DEFAULT '[]',
  resolved    INTEGER NOT NULL DEFAULT 0,
  reactions   TEXT NOT NULL DEFAULT '{}',
  at          TEXT NOT NULL,
  edited_at   TEXT
);
CREATE INDEX review_comments_review ON review_comments (review_id);

CREATE TABLE review_decisions (
  id          TEXT PRIMARY KEY,
  review_id   TEXT NOT NULL,
  version_id  TEXT NOT NULL,
  by_name     TEXT NOT NULL,
  by_email    TEXT NOT NULL DEFAULT '',
  guest       INTEGER NOT NULL DEFAULT 0,
  decision    TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL
);

CREATE TABLE review_links (
  id             TEXT PRIMARY KEY,
  review_id      TEXT NOT NULL,
  token          TEXT NOT NULL UNIQUE,
  label          TEXT NOT NULL,
  allow_comments INTEGER NOT NULL DEFAULT 1,
  allow_download INTEGER NOT NULL DEFAULT 0,
  all_versions   INTEGER NOT NULL DEFAULT 0,
  expires_at     TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  views          INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

-- Big files arrive in pieces (R2 multipart)
CREATE TABLE review_uploads (
  id           TEXT PRIMARY KEY,           -- becomes the version id
  r2_upload_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  parts        TEXT NOT NULL DEFAULT '[]',
  created_by   TEXT NOT NULL,
  at           TEXT NOT NULL
);
