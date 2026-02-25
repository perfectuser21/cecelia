-- Migration: Add OKR hierarchy support to goals table
-- This adds parent_id, type, and weight columns to support O → KR relationships

-- Add parent_id for hierarchy (NULL = top-level Objective)
ALTER TABLE goals ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES goals(id) ON DELETE CASCADE;

-- Add type to distinguish Objectives from Key Results
ALTER TABLE goals ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'objective';

-- Add weight for KR contribution to parent O progress
ALTER TABLE goals ADD COLUMN IF NOT EXISTS weight DECIMAL(3,2) DEFAULT 1.0;

-- Add constraint for type values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'goals_type_check'
  ) THEN
    ALTER TABLE goals ADD CONSTRAINT goals_type_check
      CHECK (type IN ('objective', 'key_result'));
  END IF;
END $$;

-- Add constraint for weight range (0.01 to 1.00)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'goals_weight_check'
  ) THEN
    ALTER TABLE goals ADD CONSTRAINT goals_weight_check
      CHECK (weight > 0 AND weight <= 1.0);
  END IF;
END $$;

-- Create index for parent_id queries
CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_id);

-- Create index for type queries
CREATE INDEX IF NOT EXISTS idx_goals_type ON goals(type);
