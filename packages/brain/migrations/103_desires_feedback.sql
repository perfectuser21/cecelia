-- 102_desires_feedback.sql
-- P0-B：欲望反馈闭环 - 为 desires 表添加任务完成/失败回写字段

ALTER TABLE desires
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effectiveness_score NUMERIC(3,1);

COMMENT ON COLUMN desires.completed_at IS '欲望对应任务完成时间（来自 execution-callback 回写）';
COMMENT ON COLUMN desires.failed_at IS '欲望对应任务失败时间（来自 execution-callback 回写）';
COMMENT ON COLUMN desires.effectiveness_score IS '欲望效能评分 0-10，由任务结果回写，用于影响同类欲望未来权重';

-- 允许 desires.status 包含新状态
ALTER TABLE desires DROP CONSTRAINT IF EXISTS desires_status_check;
ALTER TABLE desires ADD CONSTRAINT desires_status_check
  CHECK (status IN ('pending', 'acted', 'completed', 'failed', 'expressed', 'acknowledged'));
