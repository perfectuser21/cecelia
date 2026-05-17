-- Migration 082: Self-Model 系统
-- 为 memory_stream 表增加 source_type 列，用于标记特殊类型记录（如 self_model）

ALTER TABLE memory_stream ADD COLUMN IF NOT EXISTS source_type VARCHAR(32) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_stream_source_type
  ON memory_stream (source_type, created_at DESC)
  WHERE source_type IS NOT NULL;

-- 版本记录由 migrate.js 自动管理
