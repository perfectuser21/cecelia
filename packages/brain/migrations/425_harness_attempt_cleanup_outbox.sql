-- Durable cleanup intent for terminalized Kernel Harness attempts.

ALTER TABLE harness_attempts
  ADD COLUMN IF NOT EXISTS parent_run_terminal BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS harness_attempt_cleanup_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE RESTRICT,
  attempt_id UUID NOT NULL REFERENCES harness_attempts(id) ON DELETE RESTRICT,
  target_machine_id TEXT,
  execution_transport TEXT,
  remote_job_id TEXT,
  lease_owner TEXT,
  lease_generation INTEGER NOT NULL,
  cleanup_cause TEXT NOT NULL,
  cleanup_cause_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','leased','confirmed','blocked')),
  claim_owner TEXT,
  claim_generation BIGINT NOT NULL DEFAULT 0
    CHECK (claim_generation >= 0),
  claim_expires_at TIMESTAMPTZ,
  delivery_attempts INTEGER NOT NULL DEFAULT 0
    CHECK (delivery_attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  receipt JSONB,
  last_error_code TEXT,
  last_error_message TEXT,
  last_error_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  blocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_harness_attempt_cleanup_outbox_authority
    UNIQUE (attempt_id, lease_generation)
);

CREATE INDEX IF NOT EXISTS idx_harness_attempt_cleanup_outbox_delivery
  ON harness_attempt_cleanup_outbox (status, created_at, id)
  WHERE status IN ('pending','leased');

CREATE INDEX IF NOT EXISTS idx_harness_attempt_cleanup_outbox_pending_due
  ON harness_attempt_cleanup_outbox (available_at, created_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_harness_attempt_cleanup_outbox_lease_expiry
  ON harness_attempt_cleanup_outbox (claim_expires_at, created_at, id)
  WHERE status = 'leased';

CREATE OR REPLACE FUNCTION guard_harness_attempt_cleanup_outbox_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'
       OR NEW.claim_generation <> 0
       OR NEW.claim_owner IS NOT NULL
       OR NEW.claim_expires_at IS NOT NULL
       OR NEW.receipt IS NOT NULL
       OR NEW.confirmed_at IS NOT NULL
       OR NEW.blocked_at IS NOT NULL
       OR NEW.delivery_attempts <> 0
       OR NEW.last_error_code IS NOT NULL
       OR NEW.last_error_message IS NOT NULL
       OR NEW.last_error_at IS NOT NULL THEN
      RAISE EXCEPTION 'cleanup_outbox_invalid_initial_state';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cleanup_outbox_delete_forbidden';
  END IF;

  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.run_id IS DISTINCT FROM NEW.run_id
     OR OLD.attempt_id IS DISTINCT FROM NEW.attempt_id
     OR OLD.target_machine_id IS DISTINCT FROM NEW.target_machine_id
     OR OLD.execution_transport IS DISTINCT FROM NEW.execution_transport
     OR OLD.remote_job_id IS DISTINCT FROM NEW.remote_job_id
     OR OLD.lease_owner IS DISTINCT FROM NEW.lease_owner
     OR OLD.lease_generation IS DISTINCT FROM NEW.lease_generation
     OR OLD.cleanup_cause IS DISTINCT FROM NEW.cleanup_cause
     OR OLD.cleanup_cause_message IS DISTINCT FROM NEW.cleanup_cause_message
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'cleanup_outbox_identity_immutable';
  END IF;

  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('pending','leased','blocked'))
    OR (OLD.status = 'leased' AND NEW.status IN ('pending','leased','confirmed','blocked'))
    OR (OLD.status = 'blocked' AND NEW.status IN ('pending','blocked'))
    OR (OLD.status = 'confirmed' AND NEW.status = 'confirmed')
  ) THEN
    RAISE EXCEPTION 'cleanup_outbox_invalid_status_transition:%->%',
      OLD.status, NEW.status;
  END IF;

  IF NEW.status <> 'confirmed'
     AND (
       NEW.receipt IS NOT NULL
       OR NEW.confirmed_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'cleanup_outbox_invalid_nonconfirmed_receipt';
  END IF;

  IF OLD.status = 'pending'
     AND NEW.status = 'leased'
     AND (
       NEW.claim_owner IS NULL
       OR BTRIM(NEW.claim_owner) = ''
       OR NEW.claim_generation <> OLD.claim_generation + 1
       OR NEW.claim_expires_at IS NULL
       OR NEW.claim_expires_at <= NOW()
     ) THEN
    RAISE EXCEPTION 'cleanup_outbox_invalid_lease_claim';
  END IF;

  IF OLD.status IN ('pending','blocked')
     AND NEW.status IN ('pending','blocked')
     AND (
       NEW.claim_owner IS NOT NULL
       OR NEW.claim_expires_at IS NOT NULL
       OR NEW.claim_generation IS DISTINCT FROM OLD.claim_generation
     ) THEN
    RAISE EXCEPTION 'cleanup_outbox_invalid_idle_claim_state';
  END IF;

  IF OLD.status = 'leased'
     AND NEW.status = 'leased'
     AND (
       OLD.claim_expires_at IS NULL
       OR OLD.claim_expires_at > NOW()
       OR NEW.claim_owner IS NULL
       OR BTRIM(NEW.claim_owner) = ''
       OR NEW.claim_generation <> OLD.claim_generation + 1
       OR NEW.claim_expires_at IS NULL
       OR NEW.claim_expires_at <= NOW()
     ) THEN
    RAISE EXCEPTION 'cleanup_outbox_invalid_lease_reclaim';
  END IF;

  IF OLD.status = 'leased'
     AND NEW.status IN ('pending','blocked')
     AND (
       OLD.claim_owner IS NULL
       OR NEW.claim_owner IS NOT NULL
       OR NEW.claim_expires_at IS NOT NULL
       OR NEW.claim_generation IS DISTINCT FROM OLD.claim_generation
     ) THEN
    RAISE EXCEPTION 'cleanup_outbox_invalid_claim_release';
  END IF;

  IF OLD.status = 'leased'
     AND NEW.status = 'confirmed'
     AND (
       NEW.claim_owner IS DISTINCT FROM OLD.claim_owner
       OR NEW.claim_generation IS DISTINCT FROM OLD.claim_generation
       OR NEW.receipt IS NULL
       OR jsonb_typeof(NEW.receipt) IS DISTINCT FROM 'object'
       OR NEW.confirmed_at IS NULL
     ) THEN
    RAISE EXCEPTION 'cleanup_outbox_invalid_confirmation';
  END IF;

  IF OLD.status = 'confirmed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'cleanup_outbox_confirmed_immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_harness_attempt_cleanup_outbox_mutation
  ON harness_attempt_cleanup_outbox;
CREATE TRIGGER guard_harness_attempt_cleanup_outbox_mutation
BEFORE INSERT OR UPDATE OR DELETE ON harness_attempt_cleanup_outbox
FOR EACH ROW
EXECUTE FUNCTION guard_harness_attempt_cleanup_outbox_mutation();

CREATE OR REPLACE FUNCTION enqueue_terminal_harness_attempt_cleanup()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO harness_attempt_cleanup_outbox (
    run_id,
    attempt_id,
    target_machine_id,
    execution_transport,
    remote_job_id,
    lease_owner,
    lease_generation,
    cleanup_cause,
    cleanup_cause_message
  ) VALUES (
    OLD.run_id,
    OLD.id,
    COALESCE(OLD.actual_machine_id, OLD.requested_machine_id, OLD.machine_id),
    OLD.execution_transport,
    OLD.remote_job_id,
    OLD.lease_owner,
    OLD.lease_generation,
    NEW.error_code,
    NEW.error_message
  )
  ON CONFLICT (attempt_id, lease_generation) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enqueue_terminal_harness_attempt_cleanup
  ON harness_attempts;
CREATE TRIGGER enqueue_terminal_harness_attempt_cleanup
AFTER UPDATE OF status ON harness_attempts
FOR EACH ROW
WHEN (
  OLD.status IN ('queued','starting','running')
  AND NEW.status = 'cancelled'
  AND NEW.error_code = 'parent_run_terminal'
)
EXECUTE FUNCTION enqueue_terminal_harness_attempt_cleanup();

CREATE OR REPLACE FUNCTION guard_harness_attempt_insert_parent_run()
RETURNS TRIGGER AS $$
DECLARE
  parent_run RECORD;
BEGIN
  SELECT phase, orchestrator_version
    INTO parent_run
    FROM initiative_runs
   WHERE id = NEW.run_id
   FOR KEY SHARE;

  IF parent_run.orchestrator_version = 'v2'
     AND parent_run.phase IN ('done','failed') THEN
    NEW.parent_run_terminal := TRUE;
    IF NEW.status IN ('queued','starting','running') THEN
      RAISE EXCEPTION 'attempt_parent_run_terminal:%', NEW.run_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_harness_attempt_parent_run_active
  ON harness_attempts;
DROP TRIGGER IF EXISTS guard_harness_attempt_insert_parent_run
  ON harness_attempts;
CREATE TRIGGER guard_harness_attempt_insert_parent_run
BEFORE INSERT ON harness_attempts
FOR EACH ROW
EXECUTE FUNCTION guard_harness_attempt_insert_parent_run();

CREATE OR REPLACE FUNCTION guard_harness_attempt_terminal_identity()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.run_id IS DISTINCT FROM NEW.run_id THEN
    RAISE EXCEPTION 'attempt_run_id_immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.parent_run_terminal AND NOT NEW.parent_run_terminal THEN
    RAISE EXCEPTION 'attempt_parent_run_terminal_immutable'
      USING ERRCODE = '23514';
  END IF;

  IF (OLD.parent_run_terminal OR NEW.parent_run_terminal)
     AND NEW.status IN ('queued','starting','running') THEN
    RAISE EXCEPTION 'attempt_parent_run_terminal:%', NEW.run_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_harness_attempt_terminal_identity
  ON harness_attempts;
CREATE TRIGGER guard_harness_attempt_terminal_identity
BEFORE UPDATE OF status, run_id, parent_run_terminal ON harness_attempts
FOR EACH ROW
EXECUTE FUNCTION guard_harness_attempt_terminal_identity();

CREATE OR REPLACE FUNCTION terminalize_v2_run_active_attempts()
RETURNS TRIGGER AS $$
DECLARE
  current_run RECORD;
  attempt_row RECORD;
BEGIN
  SELECT id, phase, orchestrator_version
    INTO current_run
    FROM initiative_runs
   WHERE id = NEW.id
   FOR UPDATE;

  IF current_run.orchestrator_version <> 'v2'
     OR current_run.phase NOT IN ('done','failed') THEN
    RETURN NULL;
  END IF;

  FOR attempt_row IN
    SELECT id, status
      FROM harness_attempts
     WHERE run_id = current_run.id
     ORDER BY id
     FOR UPDATE
  LOOP
    UPDATE harness_attempts
       SET parent_run_terminal = TRUE,
           status = CASE WHEN attempt_row.status IN ('queued','starting','running')
                         THEN 'cancelled' ELSE status END,
           error_code = CASE WHEN attempt_row.status IN ('queued','starting','running')
                             THEN 'parent_run_terminal' ELSE error_code END,
           error_message = CASE WHEN attempt_row.status IN ('queued','starting','running')
                                THEN COALESCE(error_message, 'parent run terminal')
                                ELSE error_message END,
           lease_owner = CASE WHEN attempt_row.status IN ('queued','starting','running')
                              THEN NULL ELSE lease_owner END,
           lease_expires_at = CASE WHEN attempt_row.status IN ('queued','starting','running')
                                   THEN NULL ELSE lease_expires_at END,
           completed_at = CASE WHEN attempt_row.status IN ('queued','starting','running')
                               THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
           updated_at = NOW()
     WHERE id = attempt_row.id;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS terminalize_v2_run_active_attempts
  ON initiative_runs;
CREATE CONSTRAINT TRIGGER terminalize_v2_run_active_attempts
AFTER UPDATE OF phase, orchestrator_version ON initiative_runs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (
  NEW.orchestrator_version = 'v2'
  AND NEW.phase IN ('done','failed')
  AND (
    OLD.phase IS DISTINCT FROM NEW.phase
    OR OLD.orchestrator_version IS DISTINCT FROM NEW.orchestrator_version
  )
)
EXECUTE FUNCTION terminalize_v2_run_active_attempts();

-- Populated databases may already contain active attempts whose v2 parent
-- became terminal before migration 425 existed. Converge them under the same
-- run -> ordered attempt -> outbox lock sequence used by the deferred trigger.
DO $$
DECLARE
  terminal_run RECORD;
  attempt_row RECORD;
BEGIN
  FOR terminal_run IN
    SELECT id
      FROM initiative_runs
     WHERE orchestrator_version = 'v2'
       AND phase IN ('done','failed')
     ORDER BY id
     FOR UPDATE
  LOOP
    FOR attempt_row IN
      SELECT id, status
        FROM harness_attempts
       WHERE run_id = terminal_run.id
         AND (
           NOT parent_run_terminal
           OR status IN ('queued','starting','running')
         )
       ORDER BY id
       FOR UPDATE
    LOOP
      UPDATE harness_attempts
         SET parent_run_terminal = TRUE,
             status = CASE WHEN attempt_row.status IN ('queued','starting','running')
                           THEN 'cancelled' ELSE status END,
             error_code = CASE WHEN attempt_row.status IN ('queued','starting','running')
                               THEN 'parent_run_terminal' ELSE error_code END,
             error_message = CASE WHEN attempt_row.status IN ('queued','starting','running')
                                  THEN COALESCE(error_message,
                                    'parent run terminal during migration 425 backfill')
                                  ELSE error_message END,
             lease_owner = CASE WHEN attempt_row.status IN ('queued','starting','running')
                                THEN NULL ELSE lease_owner END,
             lease_expires_at = CASE WHEN attempt_row.status IN ('queued','starting','running')
                                     THEN NULL ELSE lease_expires_at END,
             completed_at = CASE WHEN attempt_row.status IN ('queued','starting','running')
                                 THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
             updated_at = NOW()
       WHERE id = attempt_row.id;
    END LOOP;
  END LOOP;
END;
$$;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('425', 'Durable Harness attempt cleanup outbox', NOW())
ON CONFLICT (version) DO NOTHING;
