-- Migration 193: conversation_captures 表
-- 捕获 Claude Code 会话摘要，实现跨对话持久记忆
-- Stop Hook 会话结束时自动写入

CREATE TABLE IF NOT EXISTS conversation_captures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  area TEXT,
  summary TEXT NOT NULL,
  key_decisions TEXT[] DEFAULT '{}',
  key_insights TEXT[] DEFAULT '{}',
  action_items TEXT[] DEFAULT '{}',
  author VARCHAR(32) NOT NULL DEFAULT 'cecelia',
  made_by VARCHAR(20) NOT NULL DEFAULT 'cecelia'
    CHECK (made_by IN ('user', 'cecelia', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_captures_date ON conversation_captures(session_date DESC);
CREATE INDEX IF NOT EXISTS idx_conv_captures_area ON conversation_captures(area) WHERE area IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_captures_created ON conversation_captures(created_at DESC);
