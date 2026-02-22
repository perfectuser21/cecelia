-- Migration 053: Learnings 向量化
-- 为 learnings 表添加 embedding 列 + HNSW 索引，支持向量搜索

-- 确保 pgvector 扩展存在
CREATE EXTENSION IF NOT EXISTS vector;

-- 添加 embedding 列
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 创建 HNSW 索引（cosine distance）
CREATE INDEX IF NOT EXISTS learnings_embedding_idx
  ON learnings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 更新 schema_version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('053', 'Add embedding column to learnings table for vector search', NOW())
ON CONFLICT (version) DO NOTHING;
