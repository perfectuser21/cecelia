-- Migration 368: provider-neutral Harness Commander Phase 2.
-- Formalize Commander as a normal Harness Attempt role.

ALTER TABLE harness_attempts
  DROP CONSTRAINT IF EXISTS harness_attempts_role_check;

ALTER TABLE harness_attempts
  ADD CONSTRAINT harness_attempts_role_check
  CHECK (role IN (
    'planner',
    'proposer',
    'reviewer',
    'generator',
    'evaluator',
    'judge',
    'reporter',
    'commander'
  ));

INSERT INTO schema_version (version, description, applied_at)
VALUES ('368', 'Provider-neutral Harness Commander Phase 2', NOW())
ON CONFLICT (version) DO NOTHING;
