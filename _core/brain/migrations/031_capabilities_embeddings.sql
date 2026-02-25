-- Migration 031: Add vector embeddings to capabilities table
-- Enables semantic similarity search for capability matching
--
-- Changes:
-- 1. Add embedding column (vector 1536 dimensions for OpenAI text-embedding-3-small)
-- 2. Create HNSW index for fast cosine similarity search

-- 1. Add embedding column
ALTER TABLE capabilities ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 2. Create HNSW index for cosine similarity search
-- m = 16: number of connections per layer (default, good balance)
-- ef_construction = 64: size of dynamic candidate list during index build (higher = better recall, slower build)
CREATE INDEX IF NOT EXISTS capabilities_embedding_idx
  ON capabilities
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 3. Schema version
INSERT INTO schema_version (version, description)
VALUES ('031', 'Add vector embeddings to capabilities table for semantic similarity search')
ON CONFLICT (version) DO NOTHING;
