-- @northstar_kids is off the account list for now (it isn't in the business portfolio yet).
-- Posts that were pointed at it go back to "no account chosen". Add it back later with a new migration.
UPDATE social_posts SET account = '', auto_publish = 0 WHERE account = 'ig-northstar-kids';
DELETE FROM social_accounts WHERE id = 'ig-northstar-kids';
