-- Migration 325: advancement_items 加 journey_id 列 + 放宽 ability_id 约束
-- 允许推进项挂纯 line 层级（暂未绑定具体 ability 的场景），补齐 T2(PR2 ability_id
-- 全链接线) 之后发现的缺口。

ALTER TABLE advancement_items ADD COLUMN IF NOT EXISTS journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_advancement_items_journey_id ON advancement_items (journey_id)
  WHERE journey_id IS NOT NULL;

ALTER TABLE advancement_items ALTER COLUMN ability_id DROP NOT NULL;
