-- Migration 105: Notion 同步支持
-- 为 knowledge/blocks 表添加 Notion 映射字段
-- 新建 notion_sync_log 表记录每次同步状态

-- ============================================================
-- 1. blocks 表：添加 notion_id 列
-- ============================================================
ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS notion_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_blocks_notion_id
  ON blocks (notion_id)
  WHERE notion_id IS NOT NULL;

-- ============================================================
-- 2. knowledge 表：添加 notion_synced_at 列
-- ============================================================
ALTER TABLE knowledge
  ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;

-- ============================================================
-- 3. 新建 notion_sync_log 表
-- ============================================================
CREATE TABLE IF NOT EXISTS notion_sync_log (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  direction       VARCHAR(20)   NOT NULL CHECK (direction IN ('from_notion', 'to_notion', 'both')),
  records_synced  INTEGER       NOT NULL DEFAULT 0,
  records_failed  INTEGER       NOT NULL DEFAULT 0,
  error_message   TEXT,
  details         JSONB
);

CREATE INDEX IF NOT EXISTS idx_notion_sync_log_started
  ON notion_sync_log (started_at DESC);
