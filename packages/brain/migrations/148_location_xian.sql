-- Migration 148: 添加 'xian' 到 tasks.location CHECK 约束
-- 支持西安 Mac mini 作为执行节点（Codex CLI via codex-bridge）

-- 删除旧 CHECK 约束
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_location_check;

-- 添加新 CHECK 约束（含 'xian'）
ALTER TABLE tasks ADD CONSTRAINT tasks_location_check
  CHECK (location = ANY (ARRAY['us'::text, 'hk'::text, 'xian'::text]));

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('148', 'tasks.location CHECK 添加 xian 节点（西安 Codex Bridge）', NOW())
ON CONFLICT (version) DO NOTHING;
