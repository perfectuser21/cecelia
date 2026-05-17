-- Migration 050: Focused Execution
--
-- 1. projects 表新增 sequence_order / deadline / time_budget_days
-- 2. goals 表新增 time_budget_days

-- Step 1: projects 新增字段
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sequence_order INTEGER;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS time_budget_days INTEGER;

-- Step 2: goals 新增 time_budget_days（KR 默认 30 天）
ALTER TABLE goals ADD COLUMN IF NOT EXISTS time_budget_days INTEGER DEFAULT 30;

-- Step 3: 事件记录
INSERT INTO cecelia_events (event_type, source, payload)
VALUES ('focused_execution_migration', 'migration_050', jsonb_build_object(
  'description', 'Added sequence_order, deadline, time_budget_days to projects; time_budget_days to goals',
  'timestamp', NOW()::text
));

-- Step 4: 更新 schema version
INSERT INTO schema_version (version, description) VALUES ('050', 'focused_execution')
ON CONFLICT (version) DO NOTHING;
