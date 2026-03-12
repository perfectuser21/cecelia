-- Migration: Add learning_type and source tracking fields to learnings table
-- Version: 151
-- Date: 2026-03-12
-- Description: Support /dev-perspective learning classification (5 types) and PR source tracking.
--   learning_type: trap / architecture_decision / process_improvement / failure_pattern / best_practice
--   source tracking: source_branch, source_pr, repo

-- 1. Add learning_type field
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS learning_type VARCHAR(50);

-- 2. Add constraint for valid learning_type values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'learnings_learning_type_check'
  ) THEN
    ALTER TABLE learnings
      ADD CONSTRAINT learnings_learning_type_check
        CHECK (learning_type IS NULL OR learning_type IN (
          'trap',
          'architecture_decision',
          'process_improvement',
          'failure_pattern',
          'best_practice'
        ));
  END IF;
END $$;

-- 3. Add PR source tracking fields
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS source_branch VARCHAR(200),
  ADD COLUMN IF NOT EXISTS source_pr    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS repo         VARCHAR(200);

-- 4. Indexes for querying by type and repo
CREATE INDEX IF NOT EXISTS idx_learnings_learning_type
  ON learnings (learning_type)
  WHERE learning_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learnings_repo
  ON learnings (repo)
  WHERE repo IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learnings_source_branch
  ON learnings (source_branch)
  WHERE source_branch IS NOT NULL;

-- 5. Schema version
INSERT INTO schema_version (version, description)
VALUES ('151', 'Add learning_type (5-value enum) and source tracking fields to learnings table')
ON CONFLICT (version) DO NOTHING;
