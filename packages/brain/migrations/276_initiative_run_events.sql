-- Migration 276: initiative_run_events — initiative 执行事件追踪表
-- 记录 harness initiative 执行过程中各节点状态变更事件

CREATE TABLE IF NOT EXISTS initiative_run_events (
  event_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id  UUID        NOT NULL,
  node           TEXT        CHECK (node IN ('planner', 'proposer', 'reviewer', 'generator', 'evaluator', 'report')),
  status         TEXT        CHECK (status IN ('pending', 'started', 'completed', 'failed', 'skipped')),
  payload        JSONB       DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- 复合索引：高效查询某 initiative 的所有事件（按时间顺序）
CREATE INDEX IF NOT EXISTS idx_initiative_run_events_initiative_created
  ON initiative_run_events (initiative_id, created_at);
