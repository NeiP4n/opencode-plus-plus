CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected')),
  submitter_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_at INTEGER
);

CREATE INDEX IF NOT EXISTS ideas_public_order ON ideas(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ideas_category_language ON ideas(status, category, language);
CREATE INDEX IF NOT EXISTS ideas_submitter_time ON ideas(submitter_hash, created_at);

-- Curated seeds make a new installation useful immediately.
INSERT OR IGNORE INTO ideas
  (id, title, summary, category, tags, language, status, submitter_hash, content_hash, created_at, updated_at, reviewed_at)
VALUES
  ('seed-accessibility-audit', 'Accessibility audit for small interfaces', 'Find common keyboard, contrast, and labeling issues and create a practical repair checklist.', 'Accessibility', '["a11y","testing","ui"]', 'en', 'published', 'system', 'seed-accessibility-audit-v1', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000),
  ('seed-open-source-revival', 'Open-source project revival radar', 'Find useful public projects that are neglected, have unresolved user problems, or need maintainers.', 'Open source', '["github","maintenance","research"]', 'en', 'published', 'system', 'seed-open-source-revival-v1', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000),
  ('seed-game-localization', 'Toolkit for translating older games', 'Help locate text resources, preserve formatting, check translation context, and package language patches.', 'Games and creativity', '["games","translation","localization"]', 'en', 'published', 'system', 'seed-game-localization-v1', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000),
  ('seed-docs-navigator', 'Offline documentation navigator', 'Search local documentation, connect related pages, and show exact source passages instead of unsupported answers.', 'Education', '["offline","documentation","search"]', 'en', 'published', 'system', 'seed-docs-navigator-v1', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000),
  ('seed-science-reproducibility', 'Reproducibility checklist for research', 'Help researchers record data versions, dependencies, parameters, and steps needed to repeat an experiment.', 'Science', '["research","reproducibility","checklist"]', 'en', 'published', 'system', 'seed-science-reproducibility-v1', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000),
  ('seed-local-energy', 'Private home-energy explainer', 'Turn personal electricity readings into understandable trends without uploading the readings to a cloud service.', 'Environment', '["privacy","energy","dashboard"]', 'en', 'published', 'system', 'seed-local-energy-v1', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000),
  ('seed-note-garden', 'Local knowledge garden', 'Find duplicate notes, stale instructions, and disconnected pieces of personal knowledge while keeping them on-device.', 'Productivity', '["notes","knowledge","search"]', 'en', 'published', 'system', 'seed-note-garden-v1', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000),
  ('seed-agent-audit', 'AI-agent permissions auditor', 'Explain what an agent can do, identify broad permissions, and show a readable history of risky operations.', 'Developer tools', '["agents","security","permissions"]', 'en', 'published', 'system', 'seed-agent-audit-v1', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000);
