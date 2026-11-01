-- Little Black Book: the team's vendors. Account numbers are stored encrypted (AES-GCM, key held
-- as a Worker secret, not in the database); every view or copy of one is logged in vendor_events.
CREATE TABLE vendors (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'Other',
  website       TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  account_enc   TEXT NOT NULL DEFAULT '',   -- base64 iv+ciphertext ('' = none)
  account_last4 TEXT NOT NULL DEFAULT '',
  pricing       TEXT NOT NULL DEFAULT '',
  turnaround    TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  favorite      INTEGER NOT NULL DEFAULT 0,
  contacts      TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL
);

CREATE TABLE vendor_files (
  id           TEXT PRIMARY KEY,
  vendor_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  uploaded_by  TEXT NOT NULL,
  at           TEXT NOT NULL
);
CREATE INDEX vendor_files_vendor ON vendor_files (vendor_id);

CREATE TABLE vendor_events (
  id        TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  at        TEXT NOT NULL,
  by_name   TEXT NOT NULL,
  by_email  TEXT NOT NULL DEFAULT '',
  what      TEXT NOT NULL
);
CREATE INDEX vendor_events_vendor ON vendor_events (vendor_id, at);
