-- Migration 367: provider-neutral Harness Commander Phase 1.
-- Additive persistence and rebuildable projections only. No Provider or Directive side effects.

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS commander_mode TEXT NOT NULL DEFAULT 'kernel-only'
    CHECK (commander_mode IN ('legacy-session','kernel-only','hybrid')),
  ADD COLUMN IF NOT EXISTS commander_event_version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE harness_attempts
  ADD COLUMN IF NOT EXISTS event_version BIGINT NOT NULL DEFAULT 0;

-- Phase 1 makes pause observable but does not make Commander authoritative.
ALTER TABLE initiative_runs DROP CONSTRAINT IF EXISTS initiative_runs_phase_check;
ALTER TABLE initiative_runs ADD CONSTRAINT initiative_runs_phase_check
  CHECK (phase IN (
    'A_planning','A_contract','B_task_loop','C_final_e2e',
    'done','failed','paused',
    'planning','gan','generate','evaluate'
  ));

CREATE TABLE IF NOT EXISTS harness_commander_state (
  run_id UUID PRIMARY KEY REFERENCES initiative_runs(id) ON DELETE CASCADE,
  commander_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  provider TEXT,
  account_id TEXT,
  model TEXT,
  provider_session_id TEXT,
  event_cursor BIGINT NOT NULL DEFAULT 0 CHECK (event_cursor >= 0),
  strategy_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  latest_guidance JSONB,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle','ready','running','paused','failed','completed')),
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  message_token_count INTEGER NOT NULL DEFAULT 0 CHECK (message_token_count >= 0),
  message_budget INTEGER NOT NULL DEFAULT 256 CHECK (message_budget > 0),
  message_token_budget INTEGER NOT NULL DEFAULT 100000 CHECK (message_token_budget > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS harness_run_events (
  run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE CASCADE,
  cursor BIGINT NOT NULL CHECK (cursor > 0),
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version BIGINT NOT NULL CHECK (source_version >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, cursor),
  UNIQUE (run_id, source_type, source_id, source_version)
);

CREATE INDEX IF NOT EXISTS idx_harness_run_events_source
  ON harness_run_events (run_id, source_type, source_id, source_version);

CREATE TABLE IF NOT EXISTS harness_actor_messages (
  message_cursor BIGSERIAL PRIMARY KEY,
  message_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL,
  recipient_role TEXT NOT NULL,
  thread_id UUID NOT NULL,
  correlation_id TEXT NOT NULL,
  source_attempt_id UUID REFERENCES harness_attempts(id),
  event_cursor BIGINT NOT NULL CHECK (event_cursor >= 0),
  message_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key TEXT NOT NULL,
  token_estimate INTEGER NOT NULL CHECK (token_estimate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_harness_actor_messages_recipient
  ON harness_actor_messages (run_id, recipient_role, message_cursor);

CREATE TABLE IF NOT EXISTS harness_actor_deliveries (
  message_id UUID PRIMARY KEY REFERENCES harness_actor_messages(message_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted','delivered','acked','rejected')),
  rejection_code TEXT,
  delivered_at TIMESTAMPTZ,
  acked_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS harness_actor_cursors (
  run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE CASCADE,
  actor_key TEXT NOT NULL,
  last_message_cursor BIGINT NOT NULL DEFAULT 0 CHECK (last_message_cursor >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, actor_key)
);

CREATE OR REPLACE FUNCTION harness_run_events_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'harness_run_events is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_harness_run_events_append_only ON harness_run_events;
CREATE TRIGGER trg_harness_run_events_append_only
  BEFORE UPDATE OR DELETE ON harness_run_events
  FOR EACH ROW EXECUTE FUNCTION harness_run_events_append_only();

CREATE OR REPLACE FUNCTION harness_actor_messages_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'harness_actor_messages is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_harness_actor_messages_append_only ON harness_actor_messages;
CREATE TRIGGER trg_harness_actor_messages_append_only
  BEFORE UPDATE OR DELETE ON harness_actor_messages
  FOR EACH ROW EXECUTE FUNCTION harness_actor_messages_append_only();

CREATE OR REPLACE FUNCTION append_harness_run_event(
  p_run_id UUID,
  p_event_type TEXT,
  p_source_type TEXT,
  p_source_id TEXT,
  p_source_version BIGINT,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_occurred_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  existing_cursor BIGINT;
  next_cursor BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text, 0));

  SELECT cursor
    INTO existing_cursor
    FROM harness_run_events
   WHERE run_id = p_run_id
     AND source_type = p_source_type
     AND source_id = p_source_id
     AND source_version = p_source_version;
  IF FOUND THEN
    RETURN existing_cursor;
  END IF;

  SELECT COALESCE(MAX(cursor), 0) + 1
    INTO next_cursor
    FROM harness_run_events
   WHERE run_id = p_run_id;

  INSERT INTO harness_run_events (
    run_id, cursor, event_type, source_type, source_id, source_version, payload, occurred_at
  ) VALUES (
    p_run_id,
    next_cursor,
    p_event_type,
    p_source_type,
    p_source_id,
    p_source_version,
    COALESCE(p_payload, '{}'::jsonb),
    COALESCE(p_occurred_at, NOW())
  )
  ON CONFLICT (run_id, source_type, source_id, source_version) DO NOTHING
  RETURNING cursor INTO existing_cursor;

  IF existing_cursor IS NULL THEN
    SELECT cursor
      INTO existing_cursor
      FROM harness_run_events
     WHERE run_id = p_run_id
       AND source_type = p_source_type
       AND source_id = p_source_id
       AND source_version = p_source_version;
  END IF;
  RETURN existing_cursor;
END;
$$;

CREATE OR REPLACE FUNCTION harness_attempt_event_version()
RETURNS trigger AS $$
BEGIN
  NEW.event_version := OLD.event_version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_harness_attempt_event_version ON harness_attempts;
CREATE TRIGGER trg_harness_attempt_event_version
  BEFORE UPDATE ON harness_attempts
  FOR EACH ROW EXECUTE FUNCTION harness_attempt_event_version();

CREATE OR REPLACE FUNCTION project_harness_attempt_event()
RETURNS trigger AS $$
DECLARE
  projected_event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'starting' THEN
      projected_event_type := 'attempt.starting';
    ELSIF NEW.status = 'running' THEN
      projected_event_type := 'attempt.running';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'starting' THEN
      projected_event_type := 'attempt.starting';
    ELSIF NEW.status = 'running' THEN
      projected_event_type := 'attempt.running';
    ELSIF NEW.status IN ('completed','completed_with_concerns') THEN
      projected_event_type := 'attempt.completed';
    ELSIF NEW.status IN ('needs_context','blocked','failed','cancelled') THEN
      IF NEW.error_code = 'attempt_lease_expired' THEN
        projected_event_type := 'attempt.expired';
      ELSE
        projected_event_type := 'attempt.failed';
      END IF;
    END IF;
  ELSIF NEW.heartbeat_at IS DISTINCT FROM OLD.heartbeat_at THEN
    projected_event_type := 'attempt.heartbeat';
  END IF;

  IF projected_event_type IS NOT NULL THEN
    PERFORM append_harness_run_event(
      NEW.run_id,
      projected_event_type,
      'harness_attempt',
      NEW.id::text,
      NEW.event_version,
      jsonb_strip_nulls(jsonb_build_object(
        'attempt_id', NEW.id,
        'hop', NEW.hop,
        'phase', NEW.phase,
        'role', NEW.role,
        'provider', NEW.provider,
        'account_id', NEW.account_id,
        'requested_machine_id', NEW.requested_machine_id,
        'actual_machine_id', NEW.actual_machine_id,
        'status', NEW.status,
        'failure_class', NEW.failure_class,
        'error_code', NEW.error_code
      )),
      COALESCE(NEW.updated_at, NOW())
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_harness_attempt_event ON harness_attempts;
CREATE TRIGGER trg_project_harness_attempt_event
  AFTER INSERT OR UPDATE ON harness_attempts
  FOR EACH ROW EXECUTE FUNCTION project_harness_attempt_event();

CREATE OR REPLACE FUNCTION harness_initiative_run_event_version()
RETURNS trigger AS $$
BEGIN
  IF NEW.phase IS DISTINCT FROM OLD.phase
     OR NEW.commander_mode IS DISTINCT FROM OLD.commander_mode
     OR NEW.failure_reason IS DISTINCT FROM OLD.failure_reason
     OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    NEW.commander_event_version := OLD.commander_event_version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_harness_initiative_run_event_version ON initiative_runs;
CREATE TRIGGER trg_harness_initiative_run_event_version
  BEFORE UPDATE ON initiative_runs
  FOR EACH ROW EXECUTE FUNCTION harness_initiative_run_event_version();

CREATE OR REPLACE FUNCTION project_harness_initiative_run_event()
RETURNS trigger AS $$
DECLARE
  projected_event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    projected_event_type := 'run.created';
  ELSIF NEW.phase IS DISTINCT FROM OLD.phase THEN
    IF NEW.phase = 'paused' THEN
      projected_event_type := 'run.paused';
    ELSIF NEW.phase = 'failed' THEN
      projected_event_type := 'run.failed';
    ELSIF NEW.phase = 'done' THEN
      projected_event_type := 'run.completed';
    ELSE
      projected_event_type := 'run.phase_changed';
    END IF;
  END IF;

  IF projected_event_type IS NOT NULL THEN
    PERFORM append_harness_run_event(
      NEW.id,
      projected_event_type,
      'initiative_run',
      NEW.id::text,
      NEW.commander_event_version,
      jsonb_strip_nulls(jsonb_build_object(
        'phase', NEW.phase,
        'commander_mode', NEW.commander_mode,
        'failure_reason', NEW.failure_reason,
        'completed_at', NEW.completed_at
      )),
      COALESCE(NEW.updated_at, NOW())
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_harness_initiative_run_event ON initiative_runs;
CREATE TRIGGER trg_project_harness_initiative_run_event
  AFTER INSERT OR UPDATE ON initiative_runs
  FOR EACH ROW EXECUTE FUNCTION project_harness_initiative_run_event();

CREATE OR REPLACE FUNCTION project_harness_decision_event()
RETURNS trigger AS $$
DECLARE
  previous_phase TEXT;
BEGIN
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
VALUES ('367', 'Provider-neutral Harness Commander Phase 1 persistence', NOW())
ON CONFLICT (version) DO NOTHING;
