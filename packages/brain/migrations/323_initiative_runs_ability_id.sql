-- Migration 323: initiative_runs 加 ability_id 列（ability_id 全链接线 PR2）
-- relay spawn 时从 task.ability_id 带入，供后续按 ability 聚合 run 历史。
ALTER TABLE initiative_runs ADD COLUMN IF NOT EXISTS ability_id UUID REFERENCES journey_features(id);
CREATE INDEX IF NOT EXISTS idx_initiative_runs_ability_id ON initiative_runs(ability_id);
