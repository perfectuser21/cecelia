-- Migration 382: durable grant authority for Kernel equivalence execution.
--
-- Protected grant files remain transport artifacts. These relations are the
-- immutable database authority for publication, execution intent, terminal
-- evidence, and revocation. Migration captures the explicit runtime role and
-- grants the controlled APIs only to it. Current deployments may use that same
-- role as table owner, so BEFORE INSERT contract triggers independently enforce
-- every authority invariant for ordinary owner DML. PostgreSQL owners retain
-- inherent DDL authority (including disabling triggers), which remains an
-- administrative trust boundary.
--
-- Cross-authority row locks always follow this order:
-- production lease -> execution fence (publication only) -> grant authority.
-- A path that locks only grant authority must never request a production lease.

CREATE TEMP TABLE kernel_equivalence_grant_migration_context
ON COMMIT DROP
AS SELECT current_user::name AS runtime_role;

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
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION kernel_equivalence_grant_authority_insert_guard()
RETURNS trigger AS $$
DECLARE
  payload_keys TEXT[];
  payload_grant_id UUID;
  payload_run_id UUID;
  payload_attempt_id UUID;
  payload_issued_at TIMESTAMPTZ;
  payload_expires_at TIMESTAMPTZ;
  case_resource_type TEXT;
  case_expires_at TIMESTAMPTZ;
  lease_expires_at TIMESTAMPTZ;
  database_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF jsonb_typeof(NEW.grant_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION
      'kernel equivalence grant anchor payload contract mismatch';
  END IF;
  SELECT ARRAY(
    SELECT key
      FROM jsonb_object_keys(NEW.grant_payload) AS grant_keys(key)
     ORDER BY key
  ) INTO payload_keys;
  IF payload_keys IS DISTINCT FROM ARRAY[
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
     OR NEW.grant_digest !~ '^[a-f0-9]{64}$'
     OR COALESCE(NEW.grant_payload->>'schema_version', '')
          <> 'kernel-equivalence-execution-grant/v1'
     OR COALESCE(NEW.grant_payload->>'grant_id', '')
          !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR COALESCE(NEW.grant_payload->>'run_id', '')
          !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR COALESCE(NEW.grant_payload->>'attempt_id', '')
          !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR length(
          COALESCE(NEW.grant_payload->>'cell_id', '')
        ) NOT BETWEEN 1 AND 512
     OR length(
          COALESCE(NEW.grant_payload->>'resource_id', '')
        ) NOT BETWEEN 1 AND 512
     OR length(
          COALESCE(NEW.grant_payload->>'resource_ref', '')
        ) NOT BETWEEN 1 AND 2048
     OR COALESCE(NEW.grant_payload->>'cell_id', '') ~ E'[\\000\\r\\n]'
     OR COALESCE(NEW.grant_payload->>'resource_id', '') ~ E'[\\000\\r\\n]'
     OR COALESCE(NEW.grant_payload->>'resource_ref', '') ~ E'[\\000\\r\\n]'
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant anchor payload contract mismatch';
  END IF;

  BEGIN
    payload_grant_id := (NEW.grant_payload->>'grant_id')::UUID;
    payload_run_id := (NEW.grant_payload->>'run_id')::UUID;
    payload_attempt_id := (NEW.grant_payload->>'attempt_id')::UUID;
    payload_issued_at :=
      (NEW.grant_payload->>'issued_at')::TIMESTAMPTZ;
    payload_expires_at :=
      (NEW.grant_payload->>'expires_at')::TIMESTAMPTZ;
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow THEN
      RAISE EXCEPTION
        'kernel equivalence grant anchor payload contract mismatch';
  END;

  IF NEW.grant_id IS DISTINCT FROM payload_grant_id
     OR NEW.cell_id IS DISTINCT FROM NEW.grant_payload->>'cell_id'
     OR NEW.run_id IS DISTINCT FROM payload_run_id
     OR NEW.attempt_id IS DISTINCT FROM payload_attempt_id
     OR NEW.resource_id
          IS DISTINCT FROM NEW.grant_payload->>'resource_id'
     OR NEW.resource_ref
          IS DISTINCT FROM NEW.grant_payload->>'resource_ref'
     OR NEW.grant_issued_at IS DISTINCT FROM payload_issued_at
     OR NEW.expires_at IS DISTINCT FROM payload_expires_at
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant anchor identity contract mismatch';
  END IF;

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
   WHERE bindings.case_id = NEW.case_id
     AND cases.cell_id = NEW.cell_id
     AND cases.run_id = NEW.run_id
     AND cases.attempt_id = NEW.attempt_id
     AND cases.resource_id = NEW.resource_id
     AND cases.resource_ref = NEW.resource_ref
     AND leases.owner_id =
           'brain.kernel_equivalence.production_cases'
     AND leases.state = 'prepared'
     AND cases.expires_at > database_now
     AND leases.lease_expires_at > database_now
   FOR UPDATE OF leases
   FOR SHARE OF cases, bindings;
  IF NOT FOUND
     OR NEW.resource_type IS DISTINCT FROM case_resource_type
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant anchor production contract mismatch';
  END IF;
  IF payload_issued_at > database_now + interval '1 second'
     OR payload_expires_at <= database_now
     OR payload_expires_at <= payload_issued_at
     OR payload_expires_at
          > LEAST(case_expires_at, lease_expires_at)
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant anchor expiry contract mismatch';
  END IF;

  NEW.registered_at := database_now;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION kernel_equivalence_grant_event_insert_guard()
RETURNS trigger AS $$
DECLARE
  authority_digest TEXT;
  authority_case_id UUID;
  execution_fence_active BOOLEAN;
  previous_generation BIGINT;
  previous_state TEXT;
  expected_generation BIGINT;
  expected_actor_kind TEXT;
  database_now TIMESTAMPTZ;
BEGIN
  IF NEW.state NOT IN (
       'published',
       'execution_intent',
       'effect_completed',
       'aborted_before_effect',
       'effect_unknown'
     )
     OR NEW.actor_instance_id IS NULL
     OR jsonb_typeof(NEW.details) IS DISTINCT FROM 'object'
     OR octet_length(NEW.details::TEXT) > 16384
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant event input contract mismatch';
  END IF;

  IF NEW.state IN ('published', 'execution_intent') THEN
    SELECT authorities.case_id, authorities.grant_digest
      INTO authority_case_id, authority_digest
      FROM kernel_equivalence_grant_authorities authorities
     WHERE authorities.grant_id = NEW.grant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'kernel equivalence grant event digest contract mismatch';
    END IF;
    PERFORM leases.case_id
      FROM kernel_equivalence_production_case_leases leases
      JOIN kernel_equivalence_production_cases cases
        ON cases.case_id = leases.case_id
      JOIN kernel_equivalence_production_case_bindings bindings
        ON bindings.case_id = cases.case_id
     WHERE leases.case_id = authority_case_id
     FOR UPDATE OF leases
     FOR SHARE OF cases, bindings;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'kernel equivalence grant active contract is unavailable';
    END IF;
    IF NEW.state = 'published' THEN
      SELECT fences.execution_active
        INTO execution_fence_active
        FROM kernel_equivalence_production_execution_fences fences
       WHERE fences.case_id = authority_case_id
       FOR UPDATE;
    END IF;
  END IF;

  SELECT authorities.grant_digest
    INTO authority_digest
    FROM kernel_equivalence_grant_authorities authorities
   WHERE authorities.grant_id = NEW.grant_id
   FOR UPDATE;
  IF NOT FOUND
     OR authority_digest IS DISTINCT FROM NEW.grant_digest
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant event digest contract mismatch';
  END IF;
  database_now := clock_timestamp();
  IF NEW.state = 'published'
     AND (
       execution_fence_active IS DISTINCT FROM true
     )
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant publication execution fence is inactive';
  END IF;

  SELECT events.generation, events.state
    INTO previous_generation, previous_state
    FROM kernel_equivalence_grant_events events
   WHERE events.grant_id = NEW.grant_id
   ORDER BY events.generation DESC
   LIMIT 1;
  expected_generation := COALESCE(previous_generation + 1, 1);
  IF NEW.generation IS DISTINCT FROM expected_generation THEN
    RAISE EXCEPTION
      'kernel equivalence grant event generation contract mismatch';
  END IF;
  IF previous_generation IS NULL THEN
    IF NEW.state <> 'published' THEN
      RAISE EXCEPTION
        'kernel equivalence grant event must start with publication';
    END IF;
  ELSIF NEW.state = 'execution_intent'
        AND previous_state <> 'published' THEN
    RAISE EXCEPTION
      'kernel equivalence execution intent requires publication';
  ELSIF NEW.state IN (
          'effect_completed',
          'aborted_before_effect',
          'effect_unknown'
        )
        AND previous_state <> 'execution_intent' THEN
    RAISE EXCEPTION
      'kernel equivalence terminal event requires execution intent';
  ELSIF NEW.state = 'published' THEN
    RAISE EXCEPTION
      'kernel equivalence grant event transition contract mismatch';
  END IF;

  expected_actor_kind := CASE
    WHEN NEW.state = 'published' THEN 'controller'
    ELSE 'runtime'
  END;
  IF NEW.actor_kind IS DISTINCT FROM expected_actor_kind THEN
    RAISE EXCEPTION
      'kernel equivalence grant event actor contract mismatch';
  END IF;
  IF NEW.state IN (
       'effect_completed',
       'aborted_before_effect',
       'effect_unknown'
     )
     AND (
       COALESCE(
         NEW.details->>'intent_generation',
         ''
       ) !~ '^[1-9][0-9]*$'
       OR (NEW.details->>'intent_generation')::BIGINT
            IS DISTINCT FROM previous_generation
     )
  THEN
    RAISE EXCEPTION
      'kernel equivalence terminal intent generation mismatch';
  END IF;

  IF NEW.state IN ('published', 'execution_intent') THEN
    PERFORM authorities.grant_id
      FROM kernel_equivalence_grant_authorities authorities
      JOIN kernel_equivalence_production_case_bindings bindings
        ON bindings.case_id = authorities.case_id
      JOIN kernel_equivalence_production_cases cases
        ON cases.case_id = bindings.case_id
      JOIN kernel_equivalence_production_case_leases leases
        ON leases.case_id = cases.case_id
     WHERE authorities.grant_id = NEW.grant_id
       AND authorities.grant_digest = NEW.grant_digest
       AND authorities.expires_at > database_now
       AND cases.expires_at > database_now
       AND leases.owner_id =
             'brain.kernel_equivalence.production_cases'
       AND leases.state = 'prepared'
       AND leases.lease_expires_at > database_now
       AND NOT EXISTS (
         SELECT 1
           FROM kernel_equivalence_grant_revocations revocations
          WHERE revocations.grant_id = NEW.grant_id
       )
     FOR UPDATE OF leases
     FOR SHARE OF authorities, bindings, cases;
    IF NOT FOUND THEN
      IF EXISTS (
        SELECT 1
          FROM kernel_equivalence_grant_revocations revocations
         WHERE revocations.grant_id = NEW.grant_id
      ) THEN
        RAISE EXCEPTION
          'kernel equivalence grant is revoked';
      END IF;
      RAISE EXCEPTION
        'kernel equivalence grant active contract is unavailable';
    END IF;
  END IF;

  NEW.occurred_at := database_now;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION kernel_equivalence_grant_revocation_insert_guard()
RETURNS trigger AS $$
DECLARE
  authority_digest TEXT;
BEGIN
  IF NEW.controller_instance_id IS NULL
     OR length(NEW.reason) NOT BETWEEN 1 AND 512
     OR NEW.reason !~ '^[a-z][a-z0-9_]*$'
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant revocation input contract mismatch';
  END IF;
  SELECT authorities.grant_digest
    INTO authority_digest
    FROM kernel_equivalence_grant_authorities authorities
   WHERE authorities.grant_id = NEW.grant_id
   FOR UPDATE;
  IF NOT FOUND
     OR authority_digest IS DISTINCT FROM NEW.grant_digest
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant revocation digest contract mismatch';
  END IF;

  NEW.execution_disposition := CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM kernel_equivalence_grant_events intent
       WHERE intent.grant_id = NEW.grant_id
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
  NEW.revoked_at := clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_grant_authority_insert_guard
  ON kernel_equivalence_grant_authorities;
CREATE TRIGGER trg_kernel_equivalence_grant_authority_insert_guard
  BEFORE INSERT ON kernel_equivalence_grant_authorities
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_grant_authority_insert_guard();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_grant_event_insert_guard
  ON kernel_equivalence_grant_events;
CREATE TRIGGER trg_kernel_equivalence_grant_event_insert_guard
  BEFORE INSERT ON kernel_equivalence_grant_events
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_grant_event_insert_guard();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_grant_revocation_insert_guard
  ON kernel_equivalence_grant_revocations;
CREATE TRIGGER trg_kernel_equivalence_grant_revocation_insert_guard
  BEFORE INSERT ON kernel_equivalence_grant_revocations
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_grant_revocation_insert_guard();

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
  authority_case_id UUID;
  execution_fence_active BOOLEAN;
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

  IF p_state IN ('published', 'execution_intent') THEN
    SELECT authorities.case_id, authorities.grant_digest
      INTO authority_case_id, authority_digest
      FROM kernel_equivalence_grant_authorities authorities
     WHERE authorities.grant_id = p_grant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'kernel equivalence grant event digest mismatch';
    END IF;
    PERFORM leases.case_id
      FROM kernel_equivalence_production_case_leases leases
      JOIN kernel_equivalence_production_cases cases
        ON cases.case_id = leases.case_id
      JOIN kernel_equivalence_production_case_bindings bindings
        ON bindings.case_id = cases.case_id
     WHERE leases.case_id = authority_case_id
     FOR UPDATE OF leases
     FOR SHARE OF cases, bindings;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'kernel equivalence grant active authority is expired or unavailable';
    END IF;
    IF p_state = 'published' THEN
      SELECT fences.execution_active
        INTO execution_fence_active
        FROM kernel_equivalence_production_execution_fences fences
       WHERE fences.case_id = authority_case_id
       FOR UPDATE;
    END IF;
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
  IF p_state = 'published'
     AND (
       execution_fence_active IS DISTINCT FROM true
     )
  THEN
    RAISE EXCEPTION
      'kernel equivalence grant publication execution fence is inactive';
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
     FOR UPDATE OF leases
     FOR SHARE OF authorities, bindings, cases;
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
DECLARE
  authority_case_id UUID;
BEGIN
  IF p_grant_sha256 !~ '^[a-f0-9]{64}$' THEN
    RETURN;
  END IF;
  SELECT authorities.case_id
    INTO authority_case_id
    FROM kernel_equivalence_grant_authorities authorities
   WHERE authorities.grant_id = p_grant_id
     AND authorities.grant_digest = p_grant_sha256
     AND authorities.cell_id = p_cell_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM leases.case_id
    FROM kernel_equivalence_production_case_leases leases
    JOIN kernel_equivalence_production_cases cases
      ON cases.case_id = leases.case_id
    JOIN kernel_equivalence_production_case_bindings bindings
      ON bindings.case_id = cases.case_id
   WHERE leases.case_id = authority_case_id
   FOR SHARE OF leases, cases, bindings;
  IF NOT FOUND THEN
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
   FOR SHARE OF authorities;
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

  SELECT revocations.*
    INTO existing_revocation
    FROM kernel_equivalence_grant_revocations revocations
   WHERE revocations.grant_id = p_grant_id;
  IF FOUND THEN
    IF existing_revocation.grant_digest
         IS DISTINCT FROM p_grant_sha256
       OR existing_revocation.reason IS DISTINCT FROM p_reason
       OR existing_revocation.controller_instance_id
            IS DISTINCT FROM p_controller_instance_id
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
    RETURN;
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
     computed_disposition);

  SELECT revocations.*
    INTO existing_revocation
    FROM kernel_equivalence_grant_revocations revocations
   WHERE revocations.grant_id = p_grant_id;

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

DO $$
DECLARE
  migration_runtime_role NAME;
  migration_runtime_oid OID;
  function_signature TEXT;
  function_oid OID;
  function_owner_oid OID;
  stale_grantee_oid OID;
  stale_grantee_role NAME;
BEGIN
  SELECT runtime_role
    INTO migration_runtime_role
    FROM kernel_equivalence_grant_migration_context;
  SELECT oid
    INTO migration_runtime_oid
    FROM pg_roles
   WHERE rolname = migration_runtime_role;
  IF migration_runtime_role IS NULL
     OR migration_runtime_oid IS NULL THEN
    RAISE EXCEPTION
      'kernel equivalence grant migration runtime role is unavailable';
  END IF;
  FOREACH function_signature IN ARRAY ARRAY[
    'kernel_equivalence_register_grant_authority(UUID, JSONB, TEXT)',
    'kernel_equivalence_append_grant_event(UUID, TEXT, TEXT, UUID, JSONB)',
    'kernel_equivalence_resolve_active_grant(UUID, TEXT, TEXT)',
    'kernel_equivalence_revoke_grant(UUID, TEXT, UUID, TEXT)'
  ]::TEXT[]
  LOOP
    SELECT procedures.oid, procedures.proowner
      INTO function_oid, function_owner_oid
      FROM pg_proc procedures
     WHERE procedures.oid = to_regprocedure(function_signature);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION
        'kernel equivalence grant function ACL target is unavailable: %',
        function_signature;
    END IF;
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC',
      function_signature
    );
    FOR stale_grantee_oid IN
      SELECT DISTINCT acl.grantee
        FROM pg_proc procedures
        CROSS JOIN LATERAL aclexplode(
          COALESCE(
            procedures.proacl,
            acldefault('f', procedures.proowner)
          )
        ) acl
       WHERE procedures.oid = function_oid
         AND acl.privilege_type = 'EXECUTE'
         AND acl.grantee <> 0
         AND acl.grantee <> function_owner_oid
         AND acl.grantee <> migration_runtime_oid
    LOOP
      stale_grantee_role := pg_get_userbyid(stale_grantee_oid);
      EXECUTE format(
        'REVOKE ALL ON FUNCTION %s FROM %I',
        function_signature,
        stale_grantee_role
      );
    END LOOP;
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO %I',
      function_signature,
      migration_runtime_role
    );
  END LOOP;
END;
$$;

INSERT INTO schema_version (version, description)
VALUES ('382', 'kernel_equivalence_grant_authority')
ON CONFLICT (version) DO NOTHING;
