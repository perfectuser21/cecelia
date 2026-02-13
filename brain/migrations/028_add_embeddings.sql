-- Migration 028: Add Vector Embeddings Support
-- Created: 2026-02-13
-- Purpose: Add pgvector extension and embedding columns for semantic search

-- 1. Install pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding columns (1536 dimensions for text-embedding-3-small)
-- Note: pgvector has 2000 dimension limit for indexes, so we use 1536
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 3. Create vector indexes using hnsw
-- hnsw (Hierarchical Navigable Small World) supports large dimensions (3072+)
-- m=16: number of connections per layer (good balance of speed/quality)
-- ef_construction=64: construction time parameter (higher = better quality but slower build)

CREATE INDEX IF NOT EXISTS tasks_embedding_idx
  ON tasks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS projects_embedding_idx
  ON projects
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS goals_embedding_idx
  ON goals
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 4. Update schema version
UPDATE schema_version SET version = '028';
