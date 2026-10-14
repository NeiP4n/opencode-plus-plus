-- Store Unicode-normalized search text so queries work across English, Russian, and other scripts.
ALTER TABLE ideas ADD COLUMN search_text TEXT NOT NULL DEFAULT '';

-- Existing curated seed ideas are English. SQLite lower() is sufficient for those;
-- new community ideas are normalized in JavaScript before insertion to support Unicode.
UPDATE ideas
SET search_text = lower(title || ' ' || summary || ' ' || category || ' ' || tags)
WHERE search_text = '';

CREATE INDEX IF NOT EXISTS ideas_search_text ON ideas(search_text);
