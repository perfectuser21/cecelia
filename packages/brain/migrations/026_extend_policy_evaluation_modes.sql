-- ============================================================
-- Migration 026: Extend policy_evaluations mode constraint (P1)
-- ============================================================
-- Add 'promote' and 'disable' to mode CHECK constraint
-- These are used by Promotion Job to record state transitions

-- Drop old constraint
ALTER TABLE policy_evaluations
DROP CONSTRAINT IF EXISTS policy_evaluations_mode_check;

-- Add new constraint with extended modes
ALTER TABLE policy_evaluations
ADD CONSTRAINT policy_evaluations_mode_check
CHECK (mode IN ('simulate', 'enforce', 'promote', 'disable'));

-- Update schema_version
INSERT INTO schema_version (version, description)
VALUES ('026', 'Extend policy_evaluations mode constraint for P1 (promote/disable)')
ON CONFLICT (version) DO NOTHING;

COMMENT ON COLUMN policy_evaluations.mode IS 'Execution mode: simulate(probation观察) / enforce(active执行) / promote(晋升记录) / disable(禁用记录)';
