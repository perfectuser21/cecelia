-- Migration 196: conversation_log_cursors + 扩展 conversation_captures
-- 捕获 Claude Code .jsonl 对话日志的处理进度游标
-- conversation-digest.js 模块使用此表避免重复处理

-- 1. 新增 conversation_log_cursors 表
CREATE TABLE IF NOT EXISTS conversation_log_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT NOT NULL UNIQUE,
  session_id TEXT,
  last_line_processed INTEGER NOT NULL DEFAULT 0,
  last_processed_at TIMESTAMPTZ,
  digest_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (digest_status IN ('pending', 'processing', 'done', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_log_cursors_status ON conversation_log_cursors(digest_status);
CREATE INDEX IF NOT EXISTS idx_conv_log_cursors_updated ON conversation_log_cursors(updated_at DESC);

-- 2. 扩展 conversation_captures 表：新增 digest 专用字段
ALTER TABLE conversation_captures
  ADD COLUMN IF NOT EXISTS ideas TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS open_questions TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tensions TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_file TEXT,
  ADD COLUMN IF NOT EXISTS digest_method VARCHAR(30) DEFAULT 'manual';
