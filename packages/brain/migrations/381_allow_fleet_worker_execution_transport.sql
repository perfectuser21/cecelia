-- Migration 381: keep fresh databases aligned with the production Fleet transport.

ALTER TABLE harness_attempts
  DROP CONSTRAINT IF EXISTS harness_attempts_execution_transport_check;

ALTER TABLE harness_attempts
  ADD CONSTRAINT harness_attempts_execution_transport_check
  CHECK (
    execution_transport IS NULL
    OR execution_transport IN ('local-docker', 'remote-bridge', 'fleet-worker')
  );

INSERT INTO schema_version (version, description, applied_at)
VALUES ('381', 'Allow fleet-worker harness execution transport', NOW())
ON CONFLICT (version) DO NOTHING;
