-- Migration 028: Add Vector Embeddings Support
-- Created: 2026-02-13
-- Purpose: Add pgvector extension and embedding columns for semantic search

-- 1. Install pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding columns (3072 dimensions for text-embedding-3-large)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS embedding vector(3072);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS embedding vector(3072);

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS embedding vector(3072);

-- 3. Create vector indexes using ivfflat
-- Lists parameter: sqrt(num_rows) is a good starting point
-- We use 100 as a reasonable default for initial deployment

CREATE INDEX IF NOT EXISTS tasks_embedding_idx
  ON tasks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS projects_embedding_idx
  ON projects
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS goals_embedding_idx
  ON goals
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 4. Update schema version
UPDATE schema_version SET version = '028', updated_at = CURRENT_TIMESTAMP;
