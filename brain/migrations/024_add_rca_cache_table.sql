-- Migration: Add rca_cache table for P1 RCA Deduplication
-- Purpose: Cache Cortex RCA results to prevent duplicate analysis within 24h
-- Signature: SHA256(reason_code:layer:step_name)

CREATE TABLE IF NOT EXISTS rca_cache (
  id SERIAL PRIMARY KEY,
  signature VARCHAR(16) NOT NULL UNIQUE,
  reason_code VARCHAR(50),
  layer VARCHAR(50),
  step_name VARCHAR(100),
  root_cause TEXT,
  proposed_fix TEXT,
  action_plan TEXT,
  confidence NUMERIC(3, 2) CHECK (confidence >= 0 AND confidence <= 1),
  evidence TEXT,
  ts_analyzed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast 24h lookups
CREATE INDEX idx_rca_cache_signature_ts ON rca_cache(signature, ts_analyzed);

-- Index for cleanup queries
CREATE INDEX idx_rca_cache_ts_analyzed ON rca_cache(ts_analyzed);

-- Insert schema version
INSERT INTO schema_version (version, description)
VALUES ('024', 'Add rca_cache table for P1 RCA Deduplication')
ON CONFLICT (version) DO NOTHING;
