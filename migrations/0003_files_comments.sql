-- Proof and final-artwork files (stored in R2), team-only comments, and in-app notifications.

CREATE TABLE request_files (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,          -- proof | final
  name          TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  r2_key        TEXT NOT NULL,
  uploaded_by   TEXT NOT NULL,
  at            TEXT NOT NULL
);
CREATE INDEX request_files_request ON request_files (request_id, kind, at);

CREATE TABLE request_comments (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  author_name   TEXT NOT NULL,
  author_email  TEXT NOT NULL,
  body          TEXT NOT NULL,
  at            TEXT NOT NULL
);
CREATE INDEX request_comments_request ON request_comments (request_id, at);

CREATE TABLE notifications (
  id               TEXT PRIMARY KEY,
  recipient_email  TEXT NOT NULL,
  request_id       TEXT NOT NULL,
  kind             TEXT NOT NULL,       -- comment | assigned
  actor            TEXT NOT NULL,
  message          TEXT NOT NULL,
  at               TEXT NOT NULL,
  read             INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX notifications_recipient ON notifications (recipient_email, read, at);
