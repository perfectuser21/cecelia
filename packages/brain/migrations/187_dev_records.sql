-- Migration 187: dev_records 表
-- 每个 PR 一条完整开发档案记录

CREATE TABLE IF NOT EXISTS dev_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  pr_title TEXT,
  pr_url TEXT,
  branch TEXT,
  merged_at TIMESTAMPTZ,
  prd_content TEXT,
  dod_items JSONB,
  ci_results JSONB,
  code_review_result TEXT,
  arch_review_result TEXT,
  self_score INTEGER CHECK (self_score IS NULL OR (self_score >= 1 AND self_score <= 10)),
  learning_ref TEXT,
  learning_summary TEXT,
  root_cause TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dev_records_merged_at ON dev_records(merged_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_records_task_id ON dev_records(task_id);
