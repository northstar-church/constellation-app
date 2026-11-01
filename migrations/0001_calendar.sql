-- Team calendar: events, their promo milestones, and subscribe feeds.

CREATE TABLE events (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,
  ministry     TEXT NOT NULL DEFAULT 'All church',
  start_date   TEXT NOT NULL,            -- yyyy-MM-dd
  end_date     TEXT,                     -- yyyy-MM-dd, null = single day
  start_time   TEXT,                     -- HH:mm, null = all day
  end_time     TEXT,
  location     TEXT NOT NULL DEFAULT '',
  owner        TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  template_id  TEXT,
  updated_at   TEXT NOT NULL,
  updated_by   TEXT NOT NULL
);
CREATE INDEX events_start ON events (start_date);

CREATE TABLE milestones (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  due_date    TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  owner       TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX milestones_event ON milestones (event_id);
CREATE INDEX milestones_due ON milestones (due_date);

-- Each feed is a secret subscribe link with its own filter.
CREATE TABLE feeds (
  id                  TEXT PRIMARY KEY,
  token               TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  categories          TEXT,              -- JSON array of category ids, null = all
  include_milestones  INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  created_by          TEXT NOT NULL
);
