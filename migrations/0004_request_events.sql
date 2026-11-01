-- When the requested media will be used (often an event date), and the team-calendar event made from the request.
ALTER TABLE requests ADD COLUMN event_date TEXT;
ALTER TABLE requests ADD COLUMN event_id TEXT;
