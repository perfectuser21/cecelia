-- 007_pending_actions.sql
-- 危险动作两阶段提交：pending_actions 表

-- 待审批动作表
CREATE TABLE IF NOT EXISTS pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  params JSONB,
  context JSONB,
  decision_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  status TEXT DEFAULT 'pending_approval', -- pending_approval, approved, rejected, expired
  reviewed_by TEXT,
  reviewed_at TIMESTAMP,
  execution_result JSONB,
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours')
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_pending_actions_status ON pending_actions(status);
CREATE INDEX IF NOT EXISTS idx_pending_actions_created_at ON pending_actions(created_at);

-- 更新 schema_version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('007', 'Add pending_actions table for two-phase dangerous action commit', NOW())
ON CONFLICT (version) DO NOTHING;
