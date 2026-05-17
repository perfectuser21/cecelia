-- Migration 126: 层级体系重命名 - goal type 值更新
-- global_okr → mission（Alex 使命，唯一永久）
-- area_okr   → vision（每个 Area 方向性愿景）
-- kr         → area_okr（每个 Area 季度可量化目标）

-- Step 1: 先删除旧约束（否则 UPDATE 新值会被旧约束拦截）
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_type_check;

-- Step 2: 迁移现有数据
UPDATE goals SET type = 'mission' WHERE type = 'global_okr';
UPDATE goals SET type = 'vision' WHERE type = 'area_okr';
UPDATE goals SET type = 'area_okr' WHERE type = 'kr';

-- Step 3: 添加新约束（保留 global_kr/area_kr 兼容旧数据）
ALTER TABLE goals ADD CONSTRAINT goals_type_check
  CHECK (type IN ('mission', 'vision', 'area_okr', 'global_kr', 'area_kr'));

INSERT INTO schema_version (version, description)
VALUES ('126', 'Rename goal types: global_okr→mission, area_okr→vision, kr→area_okr')
ON CONFLICT (version) DO NOTHING;
