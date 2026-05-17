-- Migration 265: initiative_runs 加 journey_type 字段
-- 供 Harness Planner Working Skeleton 方案使用
-- Spec: docs/superpowers/specs/2026-05-06-harness-working-skeleton-design.md

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS journey_type VARCHAR(20)
    NOT NULL DEFAULT 'autonomous'
    CHECK (journey_type IN ('user_facing', 'autonomous', 'dev_pipeline', 'agent_remote'));

INSERT INTO schema_version (version, description, applied_at)
VALUES ('265', 'initiative_runs: add journey_type column for Working Skeleton', NOW())
ON CONFLICT (version) DO NOTHING;
