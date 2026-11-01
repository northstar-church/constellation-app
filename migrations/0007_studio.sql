-- Creative Studio: boards (which can sit inside other boards), the cards on them, lines between cards, and uploaded images (in R2).
CREATE TABLE studio_boards (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  parent_id   TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL
);

CREATE TABLE studio_cards (
  id          TEXT PRIMARY KEY,
  board_id    TEXT NOT NULL,
  type        TEXT NOT NULL,
  x           REAL NOT NULL DEFAULT 0,
  y           REAL NOT NULL DEFAULT 0,
  w           REAL NOT NULL DEFAULT 260,
  parent_id   TEXT,                 -- the column it's stacked in
  ord         REAL NOT NULL DEFAULT 0,
  color       TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL
);
CREATE INDEX studio_cards_board ON studio_cards (board_id);

CREATE TABLE studio_lines (
  id        TEXT PRIMARY KEY,
  board_id  TEXT NOT NULL,
  from_id   TEXT NOT NULL,
  to_id     TEXT NOT NULL,
  label     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX studio_lines_board ON studio_lines (board_id);

CREATE TABLE studio_media (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  uploaded_by   TEXT NOT NULL,
  at            TEXT NOT NULL
);
