-- Migration 136: tasks 表新增 blocked 状态字段
-- 为任务韧性 Initiative 的基础数据层
-- blocked = 任务因外部依赖暂时无法执行，等条件满足后自动恢复（区别于 quarantine 的人工介入）

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_by UUID[];

-- 索引：快速查询 blocked 任务（监控告警用）
CREATE INDEX IF NOT EXISTS idx_tasks_blocked_at ON tasks (blocked_at) WHERE blocked_at IS NOT NULL;

COMMENT ON COLUMN tasks.blocked_reason IS 'blocked 状态描述，如 "等待任务 X 完成"';
COMMENT ON COLUMN tasks.blocked_at IS '进入 blocked 状态的时间';
COMMENT ON COLUMN tasks.blocked_by IS '阻塞源 task_id 列表（可选）';
