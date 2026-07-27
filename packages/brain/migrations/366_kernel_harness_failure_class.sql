-- Migration 366: persist the canonical Kernel Harness execution failure class.

ALTER TABLE harness_attempts
  ADD COLUMN IF NOT EXISTS failure_class TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'harness_attempts_failure_class_check'
       AND conrelid = 'harness_attempts'::regclass
  ) THEN
    ALTER TABLE harness_attempts
      ADD CONSTRAINT harness_attempts_failure_class_check
      CHECK (
        failure_class IS NULL
        OR failure_class IN (
          'infrastructure_blocked',
          'runner_failure',
          'semantic_refusal'
        )
      );
  END IF;
END $$;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('366', 'Persist canonical Kernel Harness execution failure class', NOW())
ON CONFLICT (version) DO NOTHING;
