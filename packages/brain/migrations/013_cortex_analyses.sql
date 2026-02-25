-- Migration 013: Cortex Analyses - Persistent Memory for RCA Results
-- Purpose: Store structured Cortex RCA analysis results for historical reference and learning

CREATE TABLE cortex_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Association
  task_id UUID REFERENCES tasks(id),
  event_id INTEGER REFERENCES cecelia_events(id),
  trigger_event_type VARCHAR(50),  -- systemic_failure, rca_request, etc.

  -- RCA Core Results
  root_cause TEXT NOT NULL,
  contributing_factors JSONB,      -- [{factor, impact, evidence}]
  mitigations JSONB,                -- [{action, expected_impact, priority}]

  -- Failure Context
  failure_pattern JSONB,            -- {class, task_type, frequency, severity}
  affected_systems JSONB,           -- [system_name, ...]

  -- Learning & Strategy
  learnings JSONB,                  -- Key insights extracted
  strategy_adjustments JSONB,       -- Recommended strategy changes

  -- Metadata
  analysis_depth VARCHAR(20),       -- quick, standard, deep
  confidence_score NUMERIC(3,2),    -- 0.00-1.00
  analyst VARCHAR(20) DEFAULT 'cortex',

  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

-- Indexes for efficient querying
CREATE INDEX idx_cortex_analyses_task_id ON cortex_analyses(task_id);
CREATE INDEX idx_cortex_analyses_created_at ON cortex_analyses(created_at DESC);
CREATE INDEX idx_cortex_analyses_trigger ON cortex_analyses(trigger_event_type);
CREATE INDEX idx_cortex_analyses_failure_pattern ON cortex_analyses USING GIN (failure_pattern);

-- Update schema_version
INSERT INTO schema_version (version, description) VALUES ('013', 'Add cortex_analyses table for persistent RCA memory');
