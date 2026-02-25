-- Modify goals table to remove multi-layer OKR fields
-- Keep only business_id for Area-level OKR

-- Add quarter field if not exists
ALTER TABLE goals ADD COLUMN IF NOT EXISTS quarter TEXT;

-- Drop columns that are no longer needed (if they exist)
ALTER TABLE goals DROP COLUMN IF EXISTS project_id;
ALTER TABLE goals DROP COLUMN IF EXISTS department_id;
ALTER TABLE goals DROP COLUMN IF EXISTS parent_id;

-- Remove progress field (progress will be calculated from KRs)
ALTER TABLE goals DROP COLUMN IF EXISTS progress;

-- Remove time tracking fields (moved to KRs)
ALTER TABLE goals DROP COLUMN IF EXISTS expected_start_date;
ALTER TABLE goals DROP COLUMN IF EXISTS expected_end_date;
ALTER TABLE goals DROP COLUMN IF EXISTS actual_start_date;
ALTER TABLE goals DROP COLUMN IF EXISTS actual_end_date;

-- Create index on business_id and quarter for faster lookups
CREATE INDEX IF NOT EXISTS idx_goals_business_id ON goals(business_id);
CREATE INDEX IF NOT EXISTS idx_goals_quarter ON goals(quarter);
