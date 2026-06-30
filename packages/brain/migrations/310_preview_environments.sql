-- migration: 310
-- description: per-branch review 预览环境端口分配表

CREATE TABLE IF NOT EXISTS preview_environments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_number     INTEGER NOT NULL,
  branch_name   TEXT NOT NULL,
  base_repo     TEXT,
  port          INTEGER NOT NULL UNIQUE,
  pid           INTEGER,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | stopped
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_preview_environments_pr ON preview_environments(pr_number);
CREATE INDEX IF NOT EXISTS idx_preview_environments_status ON preview_environments(status);
