-- Migration 364: persist the local Docker container naming contract used by recovery.

ALTER TABLE harness_attempts
  ADD COLUMN IF NOT EXISTS local_container_naming TEXT NOT NULL DEFAULT 'legacy-unsuffixed';

DO $$
BEGIN
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
VALUES ('364', 'Persist Kernel local container naming provenance', NOW())
ON CONFLICT (version) DO NOTHING;
