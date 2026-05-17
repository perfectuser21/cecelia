-- Migration 155: 为 knowledge 表添加 (type, sub_area) 唯一索引
-- 用途：支持 distill-learnings.js 脚本的幂等 upsert（ON CONFLICT DO NOTHING）
-- 只影响 type IS NOT NULL AND sub_area IS NOT NULL 的行

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_type_sub_area
  ON knowledge (type, sub_area)
  WHERE type IS NOT NULL AND sub_area IS NOT NULL;
