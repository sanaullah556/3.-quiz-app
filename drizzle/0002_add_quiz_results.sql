CREATE TABLE quiz_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  total INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  percentage INTEGER NOT NULL,
  played_at INTEGER NOT NULL
);
