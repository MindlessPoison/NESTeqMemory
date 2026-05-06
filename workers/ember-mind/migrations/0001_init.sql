-- ember-mind initial schema
-- Isolated per-mind D1; vectors live in the dedicated `ember-mind-vectors` Vectorize index.

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  weight TEXT NOT NULL DEFAULT 'medium',
  tags TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  embedded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_kind    ON memories(kind);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO meta(key, value) VALUES
  ('mind_name', 'ember'),
  ('vectorize_index', 'ember-mind-vectors'),
  ('schema_version', '1');
