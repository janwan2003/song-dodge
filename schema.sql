-- Dodgemas: storage schema (SQLite in a Durable Object; see worker/index.js)
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  rules TEXT NOT NULL DEFAULT '',
  start TEXT NOT NULL,
  end_day TEXT NOT NULL,
  tz TEXT NOT NULL,
  preset TEXT NOT NULL DEFAULT 'december',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_exp ON games(expires_at);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  is_host INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  out_at INTEGER,
  out_day INTEGER,
  out_where TEXT NOT NULL DEFAULT '',
  out_by TEXT
);
CREATE INDEX IF NOT EXISTS members_game ON members(game_id);
CREATE UNIQUE INDEX IF NOT EXISTS members_tok ON members(token_hash);
CREATE TABLE IF NOT EXISTS reactions (
  game_id TEXT NOT NULL,
  target TEXT NOT NULL,
  member_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (game_id, target, member_id)
);
CREATE TABLE IF NOT EXISTS rate (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
