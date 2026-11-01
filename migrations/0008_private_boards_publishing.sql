-- Creative Studio: private boards (only their owner sees them; boards inside follow the top board).
ALTER TABLE studio_boards ADD COLUMN visibility TEXT NOT NULL DEFAULT 'team';
ALTER TABLE studio_boards ADD COLUMN owner TEXT NOT NULL DEFAULT '';        -- display name
ALTER TABLE studio_boards ADD COLUMN owner_email TEXT NOT NULL DEFAULT '';  -- '' = made before owners existed

-- Posting Calendar: which account a post goes to, publishing on its own, and the Studio board it was planned on.
ALTER TABLE social_posts ADD COLUMN account TEXT NOT NULL DEFAULT '';
ALTER TABLE social_posts ADD COLUMN auto_publish INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_posts ADD COLUMN publish_state TEXT NOT NULL DEFAULT '';  -- '' | publishing | failed
ALTER TABLE social_posts ADD COLUMN publish_error TEXT NOT NULL DEFAULT '';
ALTER TABLE social_posts ADD COLUMN board_id TEXT NOT NULL DEFAULT '';

-- Accounts Constellation can publish to (filled in when Meta is connected; tokens live in Worker secrets).
CREATE TABLE social_accounts (
  id           TEXT PRIMARY KEY,   -- e.g. ig-<instagram user id>, fb-<page id>
  platform     TEXT NOT NULL,      -- instagram | facebook
  name         TEXT NOT NULL,
  handle       TEXT NOT NULL DEFAULT '',
  external_id  TEXT NOT NULL,      -- Instagram user id / Facebook Page id
  sort         INTEGER NOT NULL DEFAULT 0
);
