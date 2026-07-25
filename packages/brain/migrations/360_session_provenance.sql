CREATE TABLE IF NOT EXISTS session_provenance (
  session_id  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('human', 'machine')),
  launched_by TEXT NOT NULL,
  task_id     UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_version (version, description)
VALUES ('360', 'Declare human or machine provenance for conversation sessions')
ON CONFLICT (version) DO NOTHING;
