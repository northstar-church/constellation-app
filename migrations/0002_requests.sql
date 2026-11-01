-- Media requests from ministry leaders, and each request's history (drives the tracker and Slack updates).

CREATE TABLE requests (
  id               TEXT PRIMARY KEY,
  token            TEXT NOT NULL UNIQUE,      -- secret tracker link
  title            TEXT NOT NULL,
  details          TEXT NOT NULL DEFAULT '',
  deliverables     TEXT NOT NULL DEFAULT '[]', -- JSON array of labels
  ministry         TEXT NOT NULL DEFAULT '',
  requester_name   TEXT NOT NULL DEFAULT '',
  requester_email  TEXT NOT NULL DEFAULT '',
  due_date         TEXT,
  stage            TEXT NOT NULL DEFAULT 'received',
  assignee         TEXT NOT NULL DEFAULT '',
  proof_url        TEXT NOT NULL DEFAULT '',
  public_note      TEXT NOT NULL DEFAULT '',
  sort_order       REAL NOT NULL DEFAULT 0,
  source           TEXT NOT NULL DEFAULT 'manual',
  source_id        TEXT UNIQUE,                -- Typeform response token: makes webhook retries harmless
  slack_channel    TEXT,                       -- requester DM channel
  slack_ts         TEXT,                       -- parent message of the update thread
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  updated_by       TEXT NOT NULL
);
CREATE INDEX requests_stage ON requests (stage, sort_order);

CREATE TABLE request_events (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  kind        TEXT NOT NULL,     -- created | stage | note | approved | changes | proof
  stage       TEXT,
  message     TEXT NOT NULL DEFAULT '',
  by_name     TEXT NOT NULL DEFAULT '',
  public      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX request_events_request ON request_events (request_id, at);
