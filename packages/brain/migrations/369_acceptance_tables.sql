-- Migration 369: acceptance_runs / acceptance_checks — Notion Worker 验收闭环 SSOT（Acceptance 刀 1）

CREATE TABLE IF NOT EXISTS acceptance_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  gp_id TEXT,
  line TEXT,
  surface TEXT,
  version TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','passed','failed')),
  pass_rate NUMERIC(4,3),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','harness')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS acceptance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES acceptance_runs(id) ON DELETE CASCADE,
  check_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('FR','NFR','Invariant','SOP')),
  name TEXT NOT NULL,
  device TEXT,
  result TEXT CHECK (result IN ('通过','不通过','无法验证')),
  note TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acceptance_checks_run ON acceptance_checks(run_id);

CREATE INDEX IF NOT EXISTS idx_acceptance_runs_status ON acceptance_runs(status, created_at);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('369', 'Acceptance runs/checks tables for Notion Worker loop', NOW())
ON CONFLICT (version) DO NOTHING;
