-- Event Calendar staff link: a read-only page for all NorthStar staff at /track/calendar/<token> (one link; "New Link" replaces it)
CREATE TABLE calendar_link (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  token      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
