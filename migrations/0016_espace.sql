-- Event Calendar ← eSpace: events that come from eSpace, and the settings for what comes in
ALTER TABLE events ADD COLUMN espace TEXT; -- JSON (EspaceLink) for events from eSpace; NULL for the team’s own

-- eSpace categories and what each shows as on the calendar (NULL = not brought in)
CREATE TABLE espace_categories (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  map_to TEXT,
  sort   INTEGER NOT NULL DEFAULT 0
);

-- eSpace’s own ministry list (separate from the Media Request ministries)
CREATE TABLE espace_ministries (
  name TEXT PRIMARY KEY,
  sort INTEGER NOT NULL DEFAULT 0
);

-- Staff who book in eSpace, and the ministry their events belong to
CREATE TABLE espace_bookers (
  email    TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  ministry TEXT NOT NULL
);

-- Sync bookkeeping: token, last sync, last error, counts
CREATE TABLE espace_state (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- Starting lists from Jeremy (Oct 31 2026). Managed on Event Calendar → eSpace after this.
INSERT INTO espace_ministries (name, sort) VALUES ('Next Steps', 0);
INSERT INTO espace_ministries (name, sort) VALUES ('Small Groups', 1);
INSERT INTO espace_ministries (name, sort) VALUES ('Young Pros', 2);
INSERT INTO espace_ministries (name, sort) VALUES ('678', 3);
INSERT INTO espace_ministries (name, sort) VALUES ('HSM', 4);
INSERT INTO espace_ministries (name, sort) VALUES ('WAVE', 5);
INSERT INTO espace_ministries (name, sort) VALUES ('Students', 6);
INSERT INTO espace_ministries (name, sort) VALUES ('Kids', 7);
INSERT INTO espace_ministries (name, sort) VALUES ('Imagine', 8);
INSERT INTO espace_ministries (name, sort) VALUES ('Community', 9);
INSERT INTO espace_ministries (name, sort) VALUES ('Missions', 10);
INSERT INTO espace_ministries (name, sort) VALUES ('Creative/Worship', 11);
INSERT INTO espace_bookers (email, name, ministry) VALUES ('essy.collins@northstarchurch.org', 'Essy Collins', 'Next Steps');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('ca.phillips@northstarchurch.org', 'C.A. Phillips', 'Small Groups');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('bridget.turner@northstarchurch.org', 'Bridget Turner', 'Small Groups');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('greg.payne@northstarchurch.org', 'Greg Payne', 'Small Groups');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('drew.startup@northstarchurch.org', 'Drew Startup', 'Small Groups');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('chris.boggess@northstarchurch.org', 'Chris Boggess', 'Small Groups');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('kayla.stahl@northstarchurch.org', 'Kayla Stahl', 'Young Pros');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('riley.britton@northstarchurch.org', 'Riley Britton', '678');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('laura.wormald@northstarchurch.org', 'Laura Wormald', 'Students');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('terri.reichert@northstarchurch.org', 'Terri Reichert', 'Students');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('wilson.joiner@northstarchurch.org', 'Wilson Joiner', 'HSM');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('sellers.hickman@northstarchurch.org', 'Sellers Hickman', 'WAVE');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('hank.sledge@northstarchurch.org', 'Hank Sledge', 'WAVE');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('erin.weir@northstarchurch.org', 'Erin Weir', 'WAVE');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('mallory.jones@northstarchurch.org', 'Mallory Jones', 'WAVE');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('keilly.michael@northstarchurch.org', 'Keilly Michael', 'Kids');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('haley.moyer@northstarchurch.org', 'Haley Moyer', 'Kids');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('heather.adams@northstarchurch.org', 'Heather Adams', 'Kids');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('rebecca.morgan@northstarchurch.org', 'Rebecca Morgan', 'Imagine');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('zach.fisher@northstarchurch.org', 'Zach Fisher', 'Community');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('jessica.fisher@northstarchurch.org', 'Jessica Fisher', 'Community');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('jeannine.rhein@northstarchurch.org', 'Jeannine Rhein', 'Community');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('megan.strange@northstarchurch.org', 'Megan Strange', 'Missions');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('kimberly.mcdurmon@northstarchurch.org', 'Kimberly McDurmon', 'Missions');
INSERT INTO espace_bookers (email, name, ministry) VALUES ('seth.hardy@northstarchurch.org', 'Seth Hardy', 'Creative/Worship');
