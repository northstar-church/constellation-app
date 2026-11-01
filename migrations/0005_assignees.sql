-- A request can have several people on it (e.g. design + social), each checking off their own part.
ALTER TABLE requests ADD COLUMN assignees TEXT NOT NULL DEFAULT '[]';
UPDATE requests SET assignees = json_array(json_object('name', assignee, 'done', json('false'))) WHERE assignee != '';
