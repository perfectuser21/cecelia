-- Migration: 275_wechat_rpa_sessions
-- Purpose: Path 4 Sprint 1 — wechat-rpa Agent 的会话表
--
-- 背景：wechat-rpa handler 每次执行一个 RPA 动作（发消息、截图等）
--   产生一条会话记录，供审计、重试和状态追踪使用。
--
-- 设计：
--   1. action_type CHECK 约束：限定支持的 RPA 动作类型
--   2. outcome CHECK 约束：限定终态枚举
--   3. agent_id 外键 → agent_ops_agents（ON DELETE SET NULL，agent 注销不影响历史）
--   4. payload JSONB：存储动作入参（如 target_user、content、screenshot_path）
--   5. dryrun BOOLEAN：标记是否为 dry-run 执行（不产生真实副作用）

BEGIN;

CREATE TABLE IF NOT EXISTS wechat_rpa_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID REFERENCES agent_ops_agents(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL
    CONSTRAINT chk_wechat_action_type CHECK (
      action_type IN ('send_message', 'screenshot', 'click', 'read_inbox', 'health_check')
    ),
  outcome     TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT chk_wechat_outcome CHECK (
      outcome IN ('pending', 'success', 'failed', 'timeout', 'skipped_dryrun')
    ),
  dryrun      BOOLEAN NOT NULL DEFAULT FALSE,
  payload     JSONB NOT NULL DEFAULT '{}',
  result      JSONB,
  error_msg   TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 按 agent_id + 时间快速查最近会话
CREATE INDEX IF NOT EXISTS idx_wechat_rpa_sessions_agent_time
  ON wechat_rpa_sessions(agent_id, created_at DESC);

-- 按 outcome 过滤（运维监控：failed / timeout 告警）
CREATE INDEX IF NOT EXISTS idx_wechat_rpa_sessions_outcome
  ON wechat_rpa_sessions(outcome)
  WHERE outcome IN ('failed', 'timeout');

-- action_type 统计
CREATE INDEX IF NOT EXISTS idx_wechat_rpa_sessions_action_type
  ON wechat_rpa_sessions(action_type);

INSERT INTO schema_version (version, description)
VALUES ('275', 'wechat_rpa_sessions 表 — RPA 会话记录（action_type/outcome CHECK 约束，dryrun 标记）');

COMMIT;
