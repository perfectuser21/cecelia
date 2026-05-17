-- Migration 137: tasks 表添加 blocked 状态字段
-- 用于区分"临时阻塞等待自动恢复"(blocked) 与"需要人工审查"(quarantined)

-- 添加 blocked 相关字段
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_reason VARCHAR(100),
  ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMPTZ;

-- CHECK 约束：status = 'blocked' 时 blocked_at 不为空
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS chk_blocked_at_not_null;

ALTER TABLE tasks
  ADD CONSTRAINT chk_blocked_at_not_null
  CHECK (status != 'blocked' OR blocked_at IS NOT NULL);

-- 索引：供 tick 扫描 blocked 到期任务
CREATE INDEX IF NOT EXISTS idx_tasks_blocked_until
  ON tasks (blocked_until)
  WHERE status = 'blocked';

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('137', 'tasks blocked 状态字段 + CHECK 约束 + 索引', NOW())
ON CONFLICT (version) DO NOTHING;
