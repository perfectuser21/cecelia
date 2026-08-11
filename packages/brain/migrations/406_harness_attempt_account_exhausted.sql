-- Migration 406: preserve provider account exhaustion as a recoverable
-- Harness callback control class.
--
-- execution-contract.js classifies provider weekly/rate-limit failures as
-- account_exhausted so derive can retry the same role with another account.
-- Migration 378 rebuilt this constraint before that class existed, causing
-- the callback UPDATE to fail with 23514 and retry forever.

ALTER TABLE harness_attempts
  DROP CONSTRAINT IF EXISTS harness_attempts_failure_class_check;

ALTER TABLE harness_attempts
  ADD CONSTRAINT harness_attempts_failure_class_check
  CHECK (
    failure_class IS NULL
    OR failure_class IN (
      'infrastructure_blocked',
      'runner_failure',
      'semantic_refusal',
      'needs_context',
      'account_exhausted'
    )
  );

INSERT INTO schema_version (version, description, applied_at)
VALUES ('406', 'Allow recoverable account_exhausted Harness attempt class', NOW())
ON CONFLICT (version) DO NOTHING;
