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

CREATE OR REPLACE FUNCTION project_harness_decision_event()
RETURNS trigger AS $$
DECLARE
  previous_phase TEXT;
BEGIN
  IF NEW.action IN (
    'commander.directive_proposed',
    'commander.directive_accepted',
    'commander.directive_rejected',
    'commander.failover_started',
    'commander.failover_completed'
  ) THEN
    PERFORM append_harness_run_event(
      NEW.run_id,
      NEW.action,
      'orchestrator_decision',
      NEW.hop::text,
      NEW.hop,
      jsonb_strip_nulls(jsonb_build_object(
        'attempt_id', NEW.detail->>'attempt_id',
        'reason_code', NEW.detail->>'reason_code',
        'directive_action', NEW.detail #>> '{directive,action}',
        'event_cursor', NEW.detail #> '{directive,event_cursor}',
        'evidence_refs', NEW.detail #> '{directive,evidence_refs}',
        'hop', NEW.hop,
        'gate_verdict', NEW.gate_verdict
      )),
      COALESCE(NEW.created_at, NOW())
    );
  END IF;

  SELECT derived_phase
    INTO previous_phase
    FROM orchestrator_decision_log
   WHERE run_id = NEW.run_id
     AND hop < NEW.hop
   ORDER BY hop DESC
   LIMIT 1;

  IF previous_phase IS NOT NULL AND NEW.derived_phase IS DISTINCT FROM previous_phase THEN
    PERFORM append_harness_run_event(
      NEW.run_id,
      'run.phase_changed',
      'orchestrator_decision',
      NEW.hop::text,
      NEW.hop,
      jsonb_strip_nulls(jsonb_build_object(
        'phase', NEW.derived_phase,
        'hop', NEW.hop,
        'gate_verdict', NEW.gate_verdict
      )),
      COALESCE(NEW.created_at, NOW())
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_harness_decision_event ON orchestrator_decision_log;
CREATE TRIGGER trg_project_harness_decision_event
  AFTER INSERT ON orchestrator_decision_log
  FOR EACH ROW EXECUTE FUNCTION project_harness_decision_event();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('368', 'Provider-neutral Harness Commander Phase 2', NOW())
ON CONFLICT (version) DO NOTHING;
