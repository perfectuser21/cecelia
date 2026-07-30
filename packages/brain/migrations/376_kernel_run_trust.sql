-- Migration 376: Kernel run trust classification and recovery lineage.
--
-- Existing history is deliberately left untrusted. Canonical writers name
-- record_trust_status='trusted' explicitly; reconciliation may promote only
-- rows backed by deterministic evidence to 'reconstructed'.

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS record_trust_status TEXT NOT NULL DEFAULT 'untrusted';

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS record_trust_reason TEXT;

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS predecessor_run_id UUID;

ALTER TABLE initiative_runs
  DROP CONSTRAINT IF EXISTS initiative_runs_record_trust_status_check;
ALTER TABLE initiative_runs
  ADD CONSTRAINT initiative_runs_record_trust_status_check
  CHECK (
    record_trust_status IN ('trusted', 'reconstructed', 'untrusted')
  ) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'initiative_runs_predecessor_run_fk'
       AND conrelid = 'initiative_runs'::regclass
  ) THEN
    ALTER TABLE initiative_runs
      ADD CONSTRAINT initiative_runs_predecessor_run_fk
      FOREIGN KEY (predecessor_run_id)
      REFERENCES initiative_runs (id)
      NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_initiative_runs_predecessor_run_id
  ON initiative_runs (predecessor_run_id)
  WHERE predecessor_run_id IS NOT NULL;
