-- Migration 342: decisions 表加 source_ref（harness judgments 对账回指，设计 2026-07-14-harness-lifecycle-gates）
-- 注意：migration 302 只加了 level/target_type/target_id/scope，没有 source_ref（勿混）。
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS source_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_decisions_source_ref ON decisions (source_ref) WHERE source_ref IS NOT NULL;
