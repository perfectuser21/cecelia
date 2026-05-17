-- Migration 084: memory_stream 加 embedding 列，接入向量语义检索
-- 目的：让情景记忆（反思洞察）支持跨语义命中，不再依赖关键词 Jaccard

ALTER TABLE memory_stream
  ADD COLUMN IF NOT EXISTS embedding vector(1536) DEFAULT NULL;

-- 为向量列创建 IVFFlat 索引（当数据量 > 1000 时生效）
-- 暂用 CREATE INDEX IF NOT EXISTS 避免重复创建
CREATE INDEX IF NOT EXISTS idx_memory_stream_embedding
  ON memory_stream USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);
