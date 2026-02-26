-- Migration 078: Add 'reviewing' status to goals table
-- Part of OKR unification: 秋米拆完 → Vivian 审核 → 用户放行

-- Drop and recreate the check constraint with 'reviewing' added
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_status_check;
ALTER TABLE goals ADD CONSTRAINT goals_status_check
  CHECK (status IN ('pending', 'needs_info', 'ready', 'decomposing', 'reviewing', 'in_progress', 'completed', 'cancelled'));
