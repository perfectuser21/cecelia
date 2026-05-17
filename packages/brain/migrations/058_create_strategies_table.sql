-- Migration: Create strategies table
-- Version: 058
-- Date: 2026-02-23
-- Description: Store converted strategies from learnings

CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  conditions JSONB DEFAULT '[]',
  actions JSONB DEFAULT '[]',
  version VARCHAR(20) DEFAULT '1.0.0',
  created_from_learning_id UUID REFERENCES learnings(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_strategies_learning_id ON strategies(created_from_learning_id);
CREATE INDEX IF NOT EXISTS idx_strategies_created_at ON strategies(created_at);
CREATE INDEX IF NOT EXISTS idx_strategies_name ON strategies(name);

-- Insert schema version
INSERT INTO schema_version (version, description)
VALUES ('058', 'Create strategies table')
ON CONFLICT (version) DO NOTHING;
