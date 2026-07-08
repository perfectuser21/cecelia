-- Migration 319: 推进项完成度模型 — advancement_items 推进账本
-- ability(journey_features kind=ability) 底下挂一串推进项。进度 done/total 由 API 现算，不落列。
-- run_id 本 PR 建好不写入（PR2 relay 认领时填）。参见 docs/superpowers/specs/2026-07-08-advancement-items-model-design.md
CREATE TABLE IF NOT EXISTS advancement_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ability_id  UUID NOT NULL REFERENCES journey_features(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  priority    TEXT NOT NULL DEFAULT 'P1',
  run_id      UUID REFERENCES initiative_runs(id) ON DELETE SET NULL,
  pr_url      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_advancement_items_ability_id ON advancement_items(ability_id);
