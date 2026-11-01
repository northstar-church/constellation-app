-- Posting Calendar: one row per platform post, plus the images/videos attached to posts (stored in R2).
CREATE TABLE social_posts (
  id           TEXT PRIMARY KEY,
  platform     TEXT NOT NULL,               -- facebook | instagram | tiktok | youtube
  title        TEXT NOT NULL DEFAULT '',    -- YouTube video title
  caption      TEXT NOT NULL DEFAULT '',
  media        TEXT NOT NULL DEFAULT '[]',  -- JSON [{id,name,kind,url}]
  date         TEXT NOT NULL DEFAULT '',    -- local date the post goes out, YYYY-MM-DD
  time         TEXT NOT NULL DEFAULT '',    -- local time, HH:MM
  at           TEXT,                        -- the same moment in UTC, for posting-time reminders
  status       TEXT NOT NULL DEFAULT 'draft',
  category     TEXT NOT NULL DEFAULT '',
  campaign     TEXT NOT NULL DEFAULT '',
  poster       TEXT NOT NULL DEFAULT '',
  author       TEXT NOT NULL DEFAULT '',
  post_url     TEXT NOT NULL DEFAULT '',
  review_note  TEXT NOT NULL DEFAULT '',
  activity     TEXT NOT NULL DEFAULT '[]',  -- JSON [{at,by,what,note?}]
  reminded_at  TEXT,                        -- when the poster was told it's time
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX social_posts_date ON social_posts (date);
CREATE INDEX social_posts_due ON social_posts (status, at);

CREATE TABLE social_media (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- image | video
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  uploaded_by   TEXT NOT NULL,
  at            TEXT NOT NULL
);
