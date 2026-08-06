CREATE TABLE IF NOT EXISTS question_pool (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pref_code TEXT NOT NULL,
  prefecture TEXT NOT NULL,
  population_band TEXT NOT NULL CHECK (population_band IN ('mega', 'large', 'medium', 'small', 'compact')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS daily_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL UNIQUE,
  challenge_date TEXT NOT NULL,
  player_name TEXT NOT NULL,
  correct_count INTEGER NOT NULL CHECK (correct_count BETWEEN 0 AND 5),
  total_time_ms INTEGER NOT NULL CHECK (total_time_ms BETWEEN 0 AND 3600000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS daily_scores_ranking_idx
  ON daily_scores (challenge_date, correct_count DESC, total_time_ms ASC, created_at ASC);
