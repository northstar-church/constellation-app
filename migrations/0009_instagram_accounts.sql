-- NorthStar's Instagram accounts, for picking where a post goes. external_id stays empty
-- until Meta is connected (then Constellation can publish to them on its own).
INSERT OR IGNORE INTO social_accounts (id, platform, name, handle, external_id, sort) VALUES
  ('ig-nsckennesaw', 'instagram', 'NorthStar Church', 'nsckennesaw', '', 0),
  ('ig-nsc-students', 'instagram', 'NorthStar Students', 'nsc.students', '', 1),
  ('ig-northstar-kids', 'instagram', 'NorthStar Kids', 'northstar_kids', '', 2);
