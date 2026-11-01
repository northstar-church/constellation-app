-- The team list (edited on the Team screen) and Constellation's own sign-in.
CREATE TABLE team_members (
  email        TEXT PRIMARY KEY,           -- lowercase church email (also how Slack finds them)
  name         TEXT NOT NULL,
  pm           INTEGER NOT NULL DEFAULT 0, -- hears about every comment
  assignable   INTEGER NOT NULL DEFAULT 1, -- in the Assigned list
  social_lead  INTEGER NOT NULL DEFAULT 0, -- approves posts (one person)
  admin        INTEGER NOT NULL DEFAULT 0, -- can change the team
  sort         INTEGER NOT NULL DEFAULT 0,
  added_at     TEXT NOT NULL,
  added_by     TEXT NOT NULL
);

-- Sign-in codes sent by Slack DM (only a hash is kept; each code lives 10 minutes)
CREATE TABLE login_codes (
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX login_codes_email ON login_codes (email, created_at);

-- Signed-in devices (only a hash of the session key is kept). A year long, renewed while used.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  agent       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_email ON sessions (email);
