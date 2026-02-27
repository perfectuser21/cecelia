-- Migration 083: 分层记忆摘要字段（L0 摘要）
--
-- 为 memory_stream 和 learnings 表添加 summary 列，
-- 支持 L0→L1 分层检索：先用 summary 快速过滤，再按需展开完整 content。
--
-- 设计：
--   summary: 最多 200 字符的 L0 摘要，用于快速相关性过滤
--   新记录：写入时自动填充（取 content 前 100 字符）
--   历史记录：summary 为 NULL，检索时直接展开（兼容）

-- 1. memory_stream 表加 summary 列
ALTER TABLE memory_stream ADD COLUMN IF NOT EXISTS summary VARCHAR(200) DEFAULT NULL;

-- 2. learnings 表加 summary 列
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS summary VARCHAR(200) DEFAULT NULL;

-- 3. 索引（供 summary 快速过滤，可选）
CREATE INDEX IF NOT EXISTS idx_memory_stream_summary
  ON memory_stream (created_at DESC)
  WHERE summary IS NOT NULL;

-- 版本记录由 migrate.js 自动管理
