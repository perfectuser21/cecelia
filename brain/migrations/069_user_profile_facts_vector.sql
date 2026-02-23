-- migration 069: user_profile_facts — 用户事实向量化存储
-- 将用户画像 raw_facts 从 JSONB 全量存储升级为独立行 + pgvector
-- 支持语义向量搜索，对话时只注入最相关的 Top-K facts

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS user_profile_facts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL DEFAULT 'owner',
  category    TEXT,                        -- 'preference', 'identity', 'work_style', 'other'
  content     TEXT NOT NULL,               -- 事实内容，如 "偏好简洁回答"
  embedding   vector(1536),               -- OpenAI text-embedding-3-small
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profile_facts_user_id
  ON user_profile_facts (user_id);

CREATE INDEX IF NOT EXISTS idx_user_profile_facts_embedding
  ON user_profile_facts USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

INSERT INTO schema_version (version, description)
VALUES ('069', 'user_profile_facts — 用户事实向量化存储（pgvector）')
ON CONFLICT (version) DO NOTHING;
