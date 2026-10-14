-- Add counters and daily contribution quotas without changing the original schema migration.
ALTER TABLE ideas ADD COLUMN signal_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS submission_rate_limits (
  submitter_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (submitter_hash, window_start)
);

CREATE INDEX IF NOT EXISTS ideas_search_order ON ideas(status, signal_count DESC, updated_at DESC);

UPDATE ideas
SET signal_count = 1
WHERE status = 'published' AND signal_count = 0;
