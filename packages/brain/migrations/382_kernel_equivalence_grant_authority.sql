-- Migration 382: durable grant authority for Kernel equivalence execution.
--
-- Protected grant files remain transport artifacts. These relations are the
-- immutable database authority for publication, execution intent, terminal
-- evidence, and revocation. A non-owner runtime role receives only controlled
-- function access; all authority writes serialize on the grant anchor row.
-- PostgreSQL owners retain inherent DDL/DML authority, so production must keep
-- the migration owner separate from the runtime role. Append-only triggers
-- still reject owner UPDATE, DELETE, and TRUNCATE, but table ownership itself
-- is an administrative trust boundary for direct INSERT.

CREATE TABLE IF NOT EXISTS kernel_equivalence_grant_authorities (
  grant_id UUID PRIMARY KEY,
  case_id UUID NOT NULL
    REFERENCES kernel_equivalence_production_case_bindings(case_id)
    ON DELETE RESTRICT,
  cell_id TEXT NOT NULL CHECK (
    length(cell_id) BETWEEN 1 AND 512
    AND cell_id !~ E'[\\000\\r\\n]'
  ),
  run_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'ephemeral_branch',
      'ephemeral_credential_lease',
      'ephemeral_database_record',
      'ephemeral_run',
      'ephemeral_staging',
      'ephemeral_workspace'
    )
  ),
  resource_id TEXT NOT NULL CHECK (
    length(resource_id) BETWEEN 1 AND 512
    AND resource_id !~ E'[\\000\\r\\n]'
  ),
  resource_ref TEXT NOT NULL CHECK (
    length(resource_ref) BETWEEN 1 AND 2048
    AND resource_ref !~ E'[\\000\\r\\n]'
  ),
  grant_digest TEXT NOT NULL CHECK (
    grant_digest ~ '^[a-f0-9]{64}$'
  ),
  grant_payload JSONB NOT NULL CHECK (
    jsonb_typeof(grant_payload) = 'object'
  ),
  grant_issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (case_id, grant_id),
  CHECK (grant_issued_at < expires_at),
  CHECK (grant_issued_at <= registered_at + interval '1 second')
);

CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_grant_authority_case
  ON kernel_equivalence_grant_authorities
    (case_id, expires_at, grant_id);

CREATE TABLE IF NOT EXISTS kernel_equivalence_grant_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id UUID NOT NULL
    REFERENCES kernel_equivalence_grant_authorities(grant_id)
    ON DELETE RESTRICT,
  generation BIGINT NOT NULL CHECK (generation >= 1),
  state TEXT NOT NULL CHECK (state IN (
    'published',
    'execution_intent',
    'effect_completed',
    'aborted_before_effect',
    'effect_unknown'
  )),
  actor_instance_id UUID NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('controller', 'runtime')),
  grant_digest TEXT NOT NULL CHECK (
    grant_digest ~ '^[a-f0-9]{64}$'
  ),
  details JSONB NOT NULL CHECK (
    jsonb_typeof(details) = 'object'
    AND octet_length(details::text) <= 16384
  ),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (grant_id, generation),
  CHECK (
    (state = 'published' AND actor_kind = 'controller')
    OR (
      state IN (
        'execution_intent',
        'effect_completed',
        'aborted_before_effect',
        'effect_unknown'
      )
      AND actor_kind = 'runtime'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_grant_events_history
  ON kernel_equivalence_grant_events
    (grant_id, generation, occurred_at);

CREATE TABLE IF NOT EXISTS kernel_equivalence_grant_revocations (
  grant_id UUID PRIMARY KEY
    REFERENCES kernel_equivalence_grant_authorities(grant_id)
    ON DELETE RESTRICT,
  grant_digest TEXT NOT NULL CHECK (
    grant_digest ~ '^[a-f0-9]{64}$'
  ),
  reason TEXT NOT NULL CHECK (
    length(reason) BETWEEN 1 AND 512
    AND reason ~ '^[a-z][a-z0-9_]*$'
  ),
  controller_instance_id UUID NOT NULL,
  execution_disposition TEXT NOT NULL CHECK (
    execution_disposition IN ('safe_no_effect', 'effect_possible')
  ),
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_grant_revoked_at
  ON kernel_equivalence_grant_revocations
    (revoked_at, grant_id);

CREATE OR REPLACE FUNCTION kernel_equivalence_grant_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'kernel equivalence grant authority is append-only (% blocked)',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_grant_authorities_append_only
  ON kernel_equivalence_grant_authorities;
CREATE TRIGGER trg_kernel_equivalence_grant_authorities_append_only
  BEFORE UPDATE OR DELETE ON kernel_equivalence_grant_authorities
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_grant_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_grant_authorities_no_truncate
  ON kernel_equivalence_grant_authorities;
CREATE TRIGGER trg_kernel_equivalence_grant_authorities_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_grant_authorities
  FOR EACH STATEMENT
  EXECUTE FUNCTION kernel_equivalence_grant_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_grant_events_append_only
  ON kernel_equivalence_grant_events;
CREATE TRIGGER trg_kernel_equivalence_grant_events_append_only
  BEFORE UPDATE OR DELETE ON kernel_equivalence_grant_events
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_grant_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_grant_events_no_truncate
  ON kernel_equivalence_grant_events;
CREATE TRIGGER trg_kernel_equivalence_grant_events_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_grant_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION kernel_equivalence_grant_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_grant_revocations_append_only
  ON kernel_equivalence_grant_revocations;
CREATE TRIGGER trg_kernel_equivalence_grant_revocations_append_only
  BEFORE UPDATE OR DELETE ON kernel_equivalence_grant_revocations
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_grant_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_grant_revocations_no_truncate
  ON kernel_equivalence_grant_revocations;
CREATE TRIGGER trg_kernel_equivalence_grant_revocations_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_grant_revocations
  FOR EACH STATEMENT
  EXECUTE FUNCTION kernel_equivalence_grant_append_only();

REVOKE ALL ON TABLE kernel_equivalence_grant_authorities FROM PUBLIC;
REVOKE ALL ON TABLE kernel_equivalence_grant_events FROM PUBLIC;
REVOKE ALL ON TABLE kernel_equivalence_grant_revocations FROM PUBLIC;

CREATE OR REPLACE FUNCTION kernel_equivalence_register_grant_authority(
  p_case_id UUID,
  p_grant JSONB,
  p_grant_sha256 TEXT
)
RETURNS TABLE (
  grant_id UUID,
  grant_ref TEXT,
  grant_sha256 TEXT,
  cell_id TEXT,
  expires_at TIMESTAMPTZ
) AS $$
DECLARE
  parsed_grant_id UUID;
  parsed_cell_id TEXT;
  parsed_run_id UUID;
  parsed_attempt_id UUID;
  parsed_resource_id TEXT;
  parsed_resource_ref TEXT;
  parsed_issued_at TIMESTAMPTZ;
  grant_expires_at TIMESTAMPTZ;
  case_resource_type TEXT;
  case_expires_at TIMESTAMPTZ;
  lease_expires_at TIMESTAMPTZ;
BEGIN
  IF jsonb_typeof(p_grant) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION
      'kernel equivalence grant payload or digest is invalid';
  END IF;
  IF ARRAY(
       SELECT key
         FROM jsonb_object_keys(p_grant) AS grant_keys(key)
        ORDER BY key
     ) IS DISTINCT FROM ARRAY[
       'adapter_id',
       'artifact_sha',
       'attempt_id',
       'behavior_id',
       'brain_version',
       'cell_id',
       'engine_version',
       'environment',
       'expires_at',
       'grant_id',
       'issued_at',
       'key_id',
       'nonce',
       'provider',
       'resource_id',
       'resource_prefix',
       'resource_ref',
       'run_id',
       'scenario',
       'schema_version',
       'scopes',
       'seam_id',
       'signature'
     ]::TEXT[]
     OR p_grant_sha256 !~ '^[a-f0-9]{64}$'
     OR COALESCE(p_grant->>'schema_version', '')
          <> 'kernel-equivalence-execution-grant/v1'
     OR COALESCE(p_grant->>'grant_id', '')
          !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR COALESCE(p_grant->>'run_id', '')
          !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR COALESCE(p_grant->>'attempt_id', '')
          !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR length(COALESCE(p_grant->>'cell_id', '')) NOT BETWEEN 1 AND 512
     OR length(COALESCE(p_grant->>'resource_id', '')) NOT BETWEEN 1 AND 512
     OR length(COALESCE(p_grant->>'resource_ref', '')) NOT BETWEEN 1 AND 2048
     OR COALESCE(p_grant->>'cell_id', '') ~ E'[\\000\\r\\n]'
     OR COALESCE(p_grant->>'resource_id', '') ~ E'[\\000\\r\\n]'
     OR COALESCE(p_grant->>'resource_ref', '') ~ E'[\\000\\r\\n]'
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant payload or digest is invalid';
  END IF;

  BEGIN
    parsed_grant_id := (p_grant->>'grant_id')::UUID;
    parsed_run_id := (p_grant->>'run_id')::UUID;
    parsed_attempt_id := (p_grant->>'attempt_id')::UUID;
    parsed_issued_at := (p_grant->>'issued_at')::TIMESTAMPTZ;
    grant_expires_at := (p_grant->>'expires_at')::TIMESTAMPTZ;
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow THEN
      RAISE EXCEPTION
        'kernel equivalence grant payload timestamp or identity is invalid';
  END;
  parsed_cell_id := p_grant->>'cell_id';
  parsed_resource_id := p_grant->>'resource_id';
  parsed_resource_ref := p_grant->>'resource_ref';

  SELECT
      cases.resource_type,
      cases.expires_at,
      leases.lease_expires_at
    INTO
      case_resource_type,
      case_expires_at,
      lease_expires_at
    FROM kernel_equivalence_production_case_bindings bindings
    JOIN kernel_equivalence_production_cases cases
      ON cases.case_id = bindings.case_id
    JOIN kernel_equivalence_production_case_leases leases
      ON leases.case_id = cases.case_id
   WHERE bindings.case_id = p_case_id
     AND cases.cell_id = parsed_cell_id
     AND cases.run_id = parsed_run_id
     AND cases.attempt_id = parsed_attempt_id
     AND cases.resource_id = parsed_resource_id
     AND cases.resource_ref = parsed_resource_ref
     AND leases.owner_id =
           'brain.kernel_equivalence.production_cases'
     AND leases.state = 'prepared'
     AND cases.expires_at > clock_timestamp()
     AND leases.lease_expires_at > clock_timestamp()
   FOR UPDATE OF leases
   FOR SHARE OF cases, bindings;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'kernel equivalence grant production authority unavailable';
  END IF;

  IF parsed_issued_at > clock_timestamp() + interval '1 second'
     OR grant_expires_at <= clock_timestamp()
     OR grant_expires_at <= parsed_issued_at
     OR grant_expires_at
          > LEAST(case_expires_at, lease_expires_at)
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant expiry exceeds active authority deadline';
  END IF;

  INSERT INTO kernel_equivalence_grant_authorities
    (grant_id, case_id, cell_id, run_id, attempt_id, resource_type,
     resource_id, resource_ref, grant_digest, grant_payload,
     grant_issued_at, expires_at)
  VALUES
    (parsed_grant_id, p_case_id, parsed_cell_id, parsed_run_id,
     parsed_attempt_id, case_resource_type, parsed_resource_id,
     parsed_resource_ref, p_grant_sha256, p_grant, parsed_issued_at,
     grant_expires_at);

  RETURN QUERY SELECT
    parsed_grant_id,
    'kernel-equivalence-grant:' || parsed_grant_id::TEXT,
    p_grant_sha256,
    parsed_cell_id,
    grant_expires_at;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION kernel_equivalence_append_grant_event(
  p_grant_id UUID,
  p_grant_sha256 TEXT,
  p_state TEXT,
  p_actor_instance_id UUID,
  p_details JSONB
)
RETURNS TABLE (
  grant_id UUID,
  generation BIGINT,
  state TEXT,
  actor_instance_id UUID,
  actor_kind TEXT,
  occurred_at TIMESTAMPTZ
) AS $$
DECLARE
  authority_digest TEXT;
  previous_generation BIGINT;
  previous_state TEXT;
  next_generation BIGINT;
  derived_actor_kind TEXT;
  inserted_event_id UUID;
BEGIN
  IF p_grant_sha256 !~ '^[a-f0-9]{64}$'
     OR p_state NOT IN (
       'published',
       'execution_intent',
       'effect_completed',
       'aborted_before_effect',
       'effect_unknown'
     )
     OR p_actor_instance_id IS NULL
     OR jsonb_typeof(p_details) IS DISTINCT FROM 'object'
     OR octet_length(p_details::TEXT) > 16384
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant event input is invalid';
  END IF;

  SELECT authorities.grant_digest
    INTO authority_digest
    FROM kernel_equivalence_grant_authorities authorities
   WHERE authorities.grant_id = p_grant_id
   FOR UPDATE;
  IF NOT FOUND OR authority_digest IS DISTINCT FROM p_grant_sha256 THEN
    RAISE EXCEPTION
      'kernel equivalence grant event digest mismatch';
  END IF;

  SELECT events.generation, events.state
    INTO previous_generation, previous_state
    FROM kernel_equivalence_grant_events events
   WHERE events.grant_id = p_grant_id
   ORDER BY events.generation DESC
   LIMIT 1;
  next_generation := COALESCE(previous_generation + 1, 1);

  IF previous_generation IS NULL THEN
    IF p_state <> 'published' THEN
      RAISE EXCEPTION
        'kernel equivalence grant events must start with publication';
    END IF;
  ELSE
    IF next_generation <> previous_generation + 1 THEN
      RAISE EXCEPTION
        'kernel equivalence grant event generation mismatch';
    END IF;
    IF p_state = 'execution_intent'
       AND previous_state <> 'published' THEN
      RAISE EXCEPTION
        'kernel equivalence execution intent requires publication';
    END IF;
    IF p_state IN (
         'effect_completed',
         'aborted_before_effect',
         'effect_unknown'
       )
       AND previous_state <> 'execution_intent' THEN
      RAISE EXCEPTION
        'kernel equivalence terminal event requires execution intent';
    END IF;
    IF p_state = 'published' THEN
      RAISE EXCEPTION
        'kernel equivalence grant event transition is invalid';
    END IF;
  END IF;

  IF p_state IN (
       'effect_completed',
       'aborted_before_effect',
       'effect_unknown'
     )
     AND (
       COALESCE(p_details->>'intent_generation', '') !~ '^[1-9][0-9]*$'
       OR (p_details->>'intent_generation')::BIGINT
            IS DISTINCT FROM previous_generation
     )
  THEN
    RAISE EXCEPTION
      'kernel equivalence terminal intent generation mismatch';
  END IF;

  IF p_state IN ('published', 'execution_intent') THEN
    PERFORM authorities.grant_id
      FROM kernel_equivalence_grant_authorities authorities
      JOIN kernel_equivalence_production_case_bindings bindings
        ON bindings.case_id = authorities.case_id
      JOIN kernel_equivalence_production_cases cases
        ON cases.case_id = bindings.case_id
      JOIN kernel_equivalence_production_case_leases leases
        ON leases.case_id = cases.case_id
     WHERE authorities.grant_id = p_grant_id
       AND authorities.grant_digest = p_grant_sha256
       AND authorities.expires_at > clock_timestamp()
       AND cases.expires_at > clock_timestamp()
       AND leases.owner_id =
             'brain.kernel_equivalence.production_cases'
       AND leases.state = 'prepared'
       AND leases.lease_expires_at > clock_timestamp()
       AND NOT EXISTS (
         SELECT 1
           FROM kernel_equivalence_grant_revocations revocations
          WHERE revocations.grant_id = p_grant_id
       )
     FOR SHARE OF authorities, bindings, cases, leases;
    IF NOT FOUND THEN
      IF EXISTS (
        SELECT 1
          FROM kernel_equivalence_grant_revocations revocations
         WHERE revocations.grant_id = p_grant_id
      ) THEN
        RAISE EXCEPTION
          'kernel equivalence grant is revoked';
      END IF;
      RAISE EXCEPTION
        'kernel equivalence grant active authority is expired or unavailable';
    END IF;
  END IF;

  derived_actor_kind := CASE
    WHEN p_state = 'published' THEN 'controller'
    ELSE 'runtime'
  END;
  INSERT INTO kernel_equivalence_grant_events
    (grant_id, generation, state, actor_instance_id, actor_kind,
     grant_digest, details)
  VALUES
    (p_grant_id, next_generation, p_state, p_actor_instance_id,
     derived_actor_kind, p_grant_sha256, p_details)
  RETURNING event_id INTO inserted_event_id;

  RETURN QUERY
  SELECT
      events.grant_id,
      events.generation,
      events.state,
      events.actor_instance_id,
      events.actor_kind,
      events.occurred_at
    FROM kernel_equivalence_grant_events events
   WHERE events.event_id = inserted_event_id;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION kernel_equivalence_resolve_active_grant(
  p_grant_id UUID,
  p_grant_sha256 TEXT,
  p_cell_id TEXT
)
RETURNS TABLE (
  grant_id UUID,
  grant_ref TEXT,
  grant_sha256 TEXT,
  cell_id TEXT,
  expires_at TIMESTAMPTZ,
  "grant" JSONB,
  active BOOLEAN
) AS $$
BEGIN
  IF p_grant_sha256 !~ '^[a-f0-9]{64}$' THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT
      authorities.grant_id,
      'kernel-equivalence-grant:' || authorities.grant_id::TEXT,
      authorities.grant_digest,
      authorities.cell_id,
      authorities.expires_at,
      authorities.grant_payload,
      true
    FROM kernel_equivalence_grant_authorities authorities
    JOIN kernel_equivalence_production_case_bindings bindings
      ON bindings.case_id = authorities.case_id
    JOIN kernel_equivalence_production_cases cases
      ON cases.case_id = bindings.case_id
    JOIN kernel_equivalence_production_case_leases leases
      ON leases.case_id = cases.case_id
   WHERE authorities.grant_id = p_grant_id
     AND authorities.grant_digest = p_grant_sha256
     AND authorities.cell_id = p_cell_id
     AND authorities.expires_at > clock_timestamp()
     AND cases.expires_at > clock_timestamp()
     AND leases.owner_id =
           'brain.kernel_equivalence.production_cases'
     AND leases.state = 'prepared'
     AND leases.lease_expires_at > clock_timestamp()
     AND EXISTS (
       SELECT 1
         FROM kernel_equivalence_grant_events published
        WHERE published.grant_id = authorities.grant_id
          AND published.state = 'published'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM kernel_equivalence_grant_events terminal
        WHERE terminal.grant_id = authorities.grant_id
          AND terminal.state IN (
            'effect_completed',
            'aborted_before_effect',
            'effect_unknown'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM kernel_equivalence_grant_revocations revocations
        WHERE revocations.grant_id = authorities.grant_id
     )
   FOR SHARE OF authorities, bindings, cases, leases;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION kernel_equivalence_revoke_grant(
  p_grant_id UUID,
  p_grant_sha256 TEXT,
  p_controller_instance_id UUID,
  p_reason TEXT
)
RETURNS TABLE (
  grant_id UUID,
  safe_no_effect BOOLEAN,
  effect_possible BOOLEAN,
  disposition TEXT,
  revoked_at TIMESTAMPTZ
) AS $$
DECLARE
  authority_digest TEXT;
  computed_disposition TEXT;
  inserted_count INTEGER;
  existing_revocation kernel_equivalence_grant_revocations%ROWTYPE;
BEGIN
  IF p_grant_sha256 !~ '^[a-f0-9]{64}$'
     OR p_controller_instance_id IS NULL
     OR length(p_reason) NOT BETWEEN 1 AND 512
     OR p_reason !~ '^[a-z][a-z0-9_]*$'
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant revocation input is invalid';
  END IF;

  SELECT authorities.grant_digest
    INTO authority_digest
    FROM kernel_equivalence_grant_authorities authorities
   WHERE authorities.grant_id = p_grant_id
   FOR UPDATE;
  IF NOT FOUND OR authority_digest IS DISTINCT FROM p_grant_sha256 THEN
    RAISE EXCEPTION
      'kernel equivalence grant revocation digest mismatch';
  END IF;

  computed_disposition := CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM kernel_equivalence_grant_events intent
       WHERE intent.grant_id = p_grant_id
         AND intent.state = 'execution_intent'
         AND NOT EXISTS (
           SELECT 1
             FROM kernel_equivalence_grant_events aborted
            WHERE aborted.grant_id = intent.grant_id
              AND aborted.state = 'aborted_before_effect'
              AND (aborted.details->>'intent_generation')::BIGINT
                    = intent.generation
         )
    ) THEN 'safe_no_effect'
    ELSE 'effect_possible'
  END;

  INSERT INTO kernel_equivalence_grant_revocations
    (grant_id, grant_digest, reason, controller_instance_id,
     execution_disposition)
  VALUES
    (p_grant_id, p_grant_sha256, p_reason, p_controller_instance_id,
     computed_disposition)
  ON CONFLICT ON CONSTRAINT kernel_equivalence_grant_revocations_pkey
  DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT revocations.*
    INTO existing_revocation
    FROM kernel_equivalence_grant_revocations revocations
   WHERE revocations.grant_id = p_grant_id;
  IF inserted_count = 0
     AND (
       existing_revocation.grant_digest IS DISTINCT FROM p_grant_sha256
       OR existing_revocation.reason IS DISTINCT FROM p_reason
       OR existing_revocation.controller_instance_id
            IS DISTINCT FROM p_controller_instance_id
       OR existing_revocation.execution_disposition
            IS DISTINCT FROM computed_disposition
     )
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant revocation idempotency identity mismatch';
  END IF;

  RETURN QUERY SELECT
    existing_revocation.grant_id,
    existing_revocation.execution_disposition = 'safe_no_effect',
    existing_revocation.execution_disposition = 'effect_possible',
    existing_revocation.execution_disposition,
    existing_revocation.revoked_at;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION
  kernel_equivalence_register_grant_authority(UUID, JSONB, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  kernel_equivalence_register_grant_authority(UUID, JSONB, TEXT)
  TO PUBLIC;

REVOKE ALL ON FUNCTION
  kernel_equivalence_append_grant_event(UUID, TEXT, TEXT, UUID, JSONB)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  kernel_equivalence_append_grant_event(UUID, TEXT, TEXT, UUID, JSONB)
  TO PUBLIC;

REVOKE ALL ON FUNCTION
  kernel_equivalence_resolve_active_grant(UUID, TEXT, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  kernel_equivalence_resolve_active_grant(UUID, TEXT, TEXT)
  TO PUBLIC;

REVOKE ALL ON FUNCTION
  kernel_equivalence_revoke_grant(UUID, TEXT, UUID, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  kernel_equivalence_revoke_grant(UUID, TEXT, UUID, TEXT)
  TO PUBLIC;

INSERT INTO schema_version (version, description)
VALUES ('382', 'kernel_equivalence_grant_authority')
ON CONFLICT (version) DO NOTHING;
