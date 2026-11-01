-- Health alerts: one row per kind of problem, so Jeremy hears about it at most once an hour.
CREATE TABLE alerts (
  key        TEXT PRIMARY KEY,   -- server-error | cron | stream | typeform | __summary
  last_sent  TEXT,               -- when a DM about this last went out
  pending    INTEGER NOT NULL DEFAULT 0,  -- times it happened since that DM
  week       INTEGER NOT NULL DEFAULT 0,  -- times this week (for the Monday summary)
  last_text  TEXT NOT NULL DEFAULT ''
);
