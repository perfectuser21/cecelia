-- Migration 148: 添加 'xian' 到 tasks.location CHECK 约束
-- 支持西安 Mac mini 作为执行节点（Codex CLI via codex-bridge）

-- 删除旧 CHECK 约束
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_location_check;

-- 添加新 CHECK 约束（含 'xian'）
ALTER TABLE tasks ADD CONSTRAINT tasks_location_check
  CHECK (location = ANY (ARRAY['us'::text, 'hk'::text, 'xian'::text]));

-- 更新 schema_migrations 版本记录
INSERT INTO schema_migrations (version) VALUES (148) ON CONFLICT DO NOTHING;
