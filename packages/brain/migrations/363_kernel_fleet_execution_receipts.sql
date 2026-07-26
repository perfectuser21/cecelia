-- Migration 363: persist Kernel fleet execution receipts and lease generations.

ALTER TABLE harness_attempts
  ADD COLUMN IF NOT EXISTS requested_machine_id TEXT,
  ADD COLUMN IF NOT EXISTS actual_machine_id TEXT,
  ADD COLUMN IF NOT EXISTS execution_transport TEXT,
  ADD COLUMN IF NOT EXISTS remote_job_id TEXT,
  ADD COLUMN IF NOT EXISTS machine_attestation_status TEXT,
  ADD COLUMN IF NOT EXISTS lease_generation INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS local_container_naming TEXT NOT NULL DEFAULT 'legacy-unsuffixed';

UPDATE harness_attempts
SET requested_machine_id = machine_id
WHERE requested_machine_id IS NULL
  AND machine_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'harness_attempts_execution_transport_check'
      AND conrelid = 'harness_attempts'::regclass
  ) THEN
    ALTER TABLE harness_attempts
      ADD CONSTRAINT harness_attempts_execution_transport_check
      CHECK (
        execution_transport IS NULL
        OR execution_transport IN ('local-docker','remote-bridge')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'harness_attempts_machine_attestation_status_check'
      AND conrelid = 'harness_attempts'::regclass
  ) THEN
    ALTER TABLE harness_attempts
      ADD CONSTRAINT harness_attempts_machine_attestation_status_check
      CHECK (
        machine_attestation_status IS NULL
        OR machine_attestation_status IN ('local','verified','rejected','pending')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'harness_attempts_local_container_naming_check'
      AND conrelid = 'harness_attempts'::regclass
  ) THEN
    ALTER TABLE harness_attempts
      ADD CONSTRAINT harness_attempts_local_container_naming_check
      CHECK (
        local_container_naming IN ('legacy-unsuffixed','generation-v1')
      );
  END IF;
END $$;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('363', 'Persist Kernel fleet execution receipts', NOW())
ON CONFLICT (version) DO NOTHING;
