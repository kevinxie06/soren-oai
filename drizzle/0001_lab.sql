CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id), kind TEXT NOT NULL, status TEXT NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, cancel INTEGER NOT NULL DEFAULT 0, progress REAL NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}', result TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(experiment_id) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id), job_id TEXT NOT NULL REFERENCES jobs(id), data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS run_experiment ON runs(experiment_id);
CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, data TEXT NOT NULL);
