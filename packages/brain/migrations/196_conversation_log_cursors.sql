-- migration 196: conversation_log_cursors
-- 追踪 Claude Code .jsonl 对话日志的处理进度
-- Brain 后台定期扫描，提炼 decisions/ideas/questions 写入 conversation_captures

CREATE TABLE IF NOT EXISTS conversation_log_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT NOT NULL UNIQUE,
  session_id TEXT,
  project_slug TEXT,
  last_line_processed INTEGER NOT NULL DEFAULT 0,
  total_lines_seen INTEGER NOT NULL DEFAULT 0,
  human_message_count INTEGER NOT NULL DEFAULT 0,
  digest_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (digest_status IN ('pending', 'processing', 'done', 'skipped', 'error')),
  last_processed_at TIMESTAMPTZ,
  digest_capture_id UUID REFERENCES conversation_captures(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_log_cursors_status
  ON conversation_log_cursors(digest_status);
CREATE INDEX IF NOT EXISTS idx_conv_log_cursors_updated
  ON conversation_log_cursors(updated_at DESC);
