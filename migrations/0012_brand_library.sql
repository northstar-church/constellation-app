-- Brand Library: the guidelines as one living document (chapters + blocks as JSON),
-- its uploaded files (in R2 under brand/<id>), and the staff page's private link.
CREATE TABLE brand_doc (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  version     INTEGER NOT NULL,
  chapters    TEXT NOT NULL,      -- JSON: Chapter[]
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL
);

CREATE TABLE brand_files (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  uploaded_by   TEXT NOT NULL,
  at            TEXT NOT NULL
);

CREATE TABLE brand_link (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  token       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL
);
