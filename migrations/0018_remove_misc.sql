-- MISC category removed: anything that used it goes back to Ministry Event / not brought in
UPDATE events SET category = 'ministry' WHERE category = 'misc';
UPDATE espace_categories SET map_to = NULL WHERE map_to = 'misc';
UPDATE feeds SET categories = (SELECT json_group_array(value) FROM json_each(feeds.categories) WHERE value != 'misc') WHERE categories LIKE '%"misc"%';
