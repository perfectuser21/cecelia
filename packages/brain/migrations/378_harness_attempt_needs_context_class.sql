-- Migration 378: preserve needs_context as its own callback control class.
--
-- Migration 366 predates the asynchronous callback routing table and only
-- allowed infrastructure_blocked, runner_failure, and semantic_refusal.
-- Collapsing needs_context into semantic_refusal makes the human-answer pause
-- indistinguishable from a refusal, so extend the existing invariant.

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
      'needs_context'
    )
  );

INSERT INTO schema_version (version, description, applied_at)
VALUES ('378', 'Allow needs_context attempt failure class', NOW())
ON CONFLICT (version) DO NOTHING;
