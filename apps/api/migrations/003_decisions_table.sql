-- Decisions Table Migration
-- Stage 3: Goal Comparison + Iterative Decision

-- Decisions table to store decision history
CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger VARCHAR(50) NOT NULL, -- tick, manual, deviation
  context JSONB,
  actions JSONB,
  confidence DECIMAL(3,2),
  status VARCHAR(50) DEFAULT 'pending', -- pending, executed, rolled_back
  executed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_trigger ON decisions(trigger);
CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at);
