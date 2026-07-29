-- Migration 381: authoritative Phase 5B production-case controller.
--
-- A production case is executable only after this migration binds it to the
-- immutable Fleet result receipt and the exact Attempt transport/session
-- facts already owned by Brain. This A1 slice deliberately supports only
-- ephemeral_run resources, whose identity is the authoritative Attempt UUID.
-- Branch, credential, workspace, staging, and database-record allocators stay
-- fail-closed until their independent Phase 5B resource authorities land.

CREATE TABLE IF NOT EXISTS kernel_equivalence_production_case_bindings (
  case_id UUID PRIMARY KEY
    REFERENCES kernel_equivalence_production_cases(case_id) ON DELETE RESTRICT,
  result_receipt_id UUID NOT NULL
    REFERENCES harness_result_receipts(receipt_id) ON DELETE RESTRICT,
  provider_session_id TEXT NOT NULL CHECK (
    length(provider_session_id) BETWEEN 1 AND 512
    AND provider_session_id !~ E'[\\000\\r\\n]'
  ),
  actual_machine_id TEXT NOT NULL CHECK (
    length(actual_machine_id) BETWEEN 1 AND 256
    AND actual_machine_id !~ E'[\\000\\r\\n]'
  ),
  execution_transport TEXT NOT NULL CHECK (execution_transport = 'fleet-worker'),
  remote_job_id TEXT NOT NULL CHECK (
    length(remote_job_id) BETWEEN 1 AND 512
    AND remote_job_id !~ E'[\\000\\r\\n]'
  ),
  task_bundle_sha256 TEXT NOT NULL CHECK (
    task_bundle_sha256 ~ '^[a-f0-9]{64}$'
  ),
  artifact_sha TEXT NOT NULL CHECK (artifact_sha ~ '^[a-f0-9]{40}$'),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_case_binding_receipt
  ON kernel_equivalence_production_case_bindings (result_receipt_id);

CREATE OR REPLACE FUNCTION kernel_equivalence_case_binding_guard()
RETURNS trigger AS $$
BEGIN
  PERFORM cases.case_id
      FROM kernel_equivalence_production_cases cases
      JOIN kernel_equivalence_production_case_leases leases
        ON leases.case_id = cases.case_id
       AND leases.owner_id
             = 'brain.kernel_equivalence.production_cases'
       AND leases.state = 'prepared'
       AND leases.lease_expires_at > clock_timestamp()
      JOIN harness_attempts attempts
        ON attempts.id = cases.attempt_id
       AND attempts.run_id = cases.run_id
      JOIN harness_result_receipts receipts
        ON receipts.receipt_id = attempts.result_receipt_id
       AND receipts.attempt_id = attempts.id
       AND receipts.run_id = attempts.run_id
     WHERE cases.case_id = NEW.case_id
       AND attempts.provider = cases.provider
       AND receipts.provider = cases.provider
       AND receipts.requested_provider = cases.provider
       AND attempts.provider_session_id IS NOT NULL
       AND receipts.provider_session_id = attempts.provider_session_id
       AND receipts.worker_id = attempts.actual_machine_id
       AND receipts.job_id = attempts.remote_job_id
       AND receipts.terminal_status = attempts.status
       AND NEW.provider_session_id = attempts.provider_session_id
       AND attempts.actual_machine_id = NEW.actual_machine_id
       AND attempts.execution_transport = NEW.execution_transport
       AND attempts.execution_transport = 'fleet-worker'
       AND attempts.remote_job_id = NEW.remote_job_id
       AND attempts.machine_attestation_status = 'verified'
       AND attempts.status IN ('completed', 'completed_with_concerns')
       AND receipts.receipt_id = NEW.result_receipt_id
       AND receipts.task_bundle_sha256 = NEW.task_bundle_sha256
       AND attempts.task_bundle
             #>> '{inputs,workspace_spec,expected_head_sha}' = cases.artifact_sha
       AND NEW.artifact_sha = cases.artifact_sha
       AND cases.resource_type = 'ephemeral_run'
       AND cases.resource_id = attempts.id::text
       AND cases.resource_ref =
             cases.resource_prefix || attempts.id::text
       AND cases.expires_at > clock_timestamp()
     FOR UPDATE OF leases
     FOR SHARE OF cases, attempts, receipts;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'kernel equivalence production case authority binding mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_case_binding_guard
  ON kernel_equivalence_production_case_bindings;
CREATE TRIGGER trg_kernel_equivalence_case_binding_guard
  BEFORE INSERT ON kernel_equivalence_production_case_bindings
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_case_binding_guard();

CREATE OR REPLACE FUNCTION kernel_equivalence_bound_attempt_immutable()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM kernel_equivalence_production_cases cases
      JOIN kernel_equivalence_production_case_bindings bindings
        ON bindings.case_id = cases.case_id
     WHERE cases.attempt_id = OLD.id
  ) AND (
    OLD.run_id IS DISTINCT FROM NEW.run_id
    OR OLD.provider IS DISTINCT FROM NEW.provider
    OR OLD.provider_session_id IS DISTINCT FROM NEW.provider_session_id
    OR OLD.actual_machine_id IS DISTINCT FROM NEW.actual_machine_id
    OR OLD.execution_transport IS DISTINCT FROM NEW.execution_transport
    OR OLD.remote_job_id IS DISTINCT FROM NEW.remote_job_id
    OR OLD.machine_attestation_status
         IS DISTINCT FROM NEW.machine_attestation_status
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.result_receipt_id IS DISTINCT FROM NEW.result_receipt_id
    OR OLD.task_bundle IS DISTINCT FROM NEW.task_bundle
  ) THEN
    RAISE EXCEPTION
      'kernel equivalence bound Attempt authority is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_bound_attempt_immutable
  ON harness_attempts;
CREATE TRIGGER trg_kernel_equivalence_bound_attempt_immutable
  BEFORE UPDATE ON harness_attempts
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_bound_attempt_immutable();

CREATE TABLE IF NOT EXISTS kernel_equivalence_production_execution_fences (
  case_id UUID PRIMARY KEY
    REFERENCES kernel_equivalence_production_case_bindings(case_id)
    ON DELETE RESTRICT,
  execution_active BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO kernel_equivalence_production_execution_fences
  (case_id, execution_active)
SELECT case_id, false
  FROM kernel_equivalence_production_case_bindings
ON CONFLICT (case_id) DO NOTHING;

CREATE OR REPLACE FUNCTION kernel_equivalence_create_execution_fence()
RETURNS trigger AS $$
BEGIN
  INSERT INTO kernel_equivalence_production_execution_fences
    (case_id, execution_active)
  VALUES (NEW.case_id, false)
  ON CONFLICT (case_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_create_execution_fence
  ON kernel_equivalence_production_case_bindings;
CREATE TRIGGER trg_kernel_equivalence_create_execution_fence
  AFTER INSERT ON kernel_equivalence_production_case_bindings
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_create_execution_fence();

CREATE OR REPLACE FUNCTION kernel_equivalence_active_execution_lease_guard()
RETURNS trigger AS $$
DECLARE
  active BOOLEAN;
  latest_state TEXT;
  expected_active BOOLEAN;
BEGIN
  SELECT execution_active
    INTO active
    FROM kernel_equivalence_production_execution_fences
   WHERE case_id = OLD.case_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'kernel equivalence production execution fence missing';
  END IF;

  SELECT state
    INTO latest_state
    FROM kernel_equivalence_production_execution_events
   WHERE case_id = OLD.case_id
   ORDER BY generation DESC
   LIMIT 1;
  expected_active := COALESCE(
    latest_state IN ('claimed', 'grant_issued', 'executing', 'reconciling'),
    false
  );
  IF active IS DISTINCT FROM expected_active THEN
    RAISE EXCEPTION
      'kernel equivalence production execution fence state mismatch';
  END IF;
  IF expected_active THEN
    RAISE EXCEPTION
      'kernel equivalence active production execution blocks lease transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_active_execution_lease_guard
  ON kernel_equivalence_production_case_leases;
CREATE TRIGGER trg_kernel_equivalence_active_execution_lease_guard
  BEFORE UPDATE OR DELETE ON kernel_equivalence_production_case_leases
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_active_execution_lease_guard();

CREATE TABLE IF NOT EXISTS kernel_equivalence_production_execution_events (
  event_id UUID PRIMARY KEY,
  case_id UUID NOT NULL
    REFERENCES kernel_equivalence_production_case_bindings(case_id)
    ON DELETE RESTRICT,
  generation BIGINT NOT NULL CHECK (generation >= 1),
  controller_instance_id UUID NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'claimed',
    'grant_issued',
    'executing',
    'reconciling',
    'succeeded',
    'blocked',
    'settlement_unknown'
  )),
  grant_ref TEXT CHECK (
    grant_ref IS NULL
    OR grant_ref ~ '^kernel-equivalence-grant:[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  ),
  grant_expires_at TIMESTAMPTZ,
  controller_lease_expires_at TIMESTAMPTZ,
  bundle_hash TEXT CHECK (
    bundle_hash IS NULL OR bundle_hash ~ '^[a-f0-9]{64}$'
  ),
  code TEXT CHECK (
    code IS NULL OR code ~ '^[a-z][a-z0-9_]{0,127}$'
  ),
  late_effect_risk BOOLEAN NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (case_id, generation),
  CHECK (
    (state = 'claimed'
      AND grant_ref IS NULL
      AND grant_expires_at IS NULL
      AND controller_lease_expires_at > occurred_at
      AND bundle_hash IS NULL
      AND code IS NULL
      AND late_effect_risk = false)
    OR (state IN ('grant_issued', 'executing')
      AND grant_ref IS NOT NULL
      AND grant_expires_at > occurred_at
      AND controller_lease_expires_at > occurred_at
      AND bundle_hash IS NULL
      AND code IS NULL
      AND late_effect_risk = false)
    OR (state = 'reconciling'
      AND grant_ref IS NULL
      AND grant_expires_at IS NULL
      AND controller_lease_expires_at > occurred_at
      AND bundle_hash IS NULL
      AND code IS NULL
      AND late_effect_risk = false)
    OR (state = 'succeeded'
      AND controller_lease_expires_at IS NULL
      AND bundle_hash IS NOT NULL
      AND code IS NULL
      AND late_effect_risk = false)
    OR (state = 'blocked'
      AND controller_lease_expires_at IS NULL
      AND bundle_hash IS NULL
      AND code IS NOT NULL
      AND late_effect_risk = false)
    OR (state = 'settlement_unknown'
      AND controller_lease_expires_at IS NULL
      AND bundle_hash IS NULL
      AND code IS NOT NULL
      AND late_effect_risk = true)
  )
);

CREATE INDEX IF NOT EXISTS idx_kernel_equivalence_execution_reconcile
  ON kernel_equivalence_production_execution_events
    (state, controller_lease_expires_at, case_id, generation DESC);

CREATE OR REPLACE FUNCTION kernel_equivalence_execution_event_guard()
RETURNS trigger AS $$
DECLARE
  previous_generation BIGINT;
  previous_state TEXT;
  previous_controller UUID;
  previous_lease_expires_at TIMESTAMPTZ;
  previous_grant_ref TEXT;
  lineage_grant_ref TEXT;
  published_grant_count BIGINT := 0;
  exact_published_grant BOOLEAN := false;
  durable_revocation_disposition TEXT;
  fence_active BOOLEAN;
  authority_now TIMESTAMPTZ;
  case_expires_at TIMESTAMPTZ;
  production_lease_expires_at TIMESTAMPTZ;
  production_lease_owner TEXT;
  production_lease_state TEXT;
BEGIN
  SELECT
      generation,
      state,
      controller_instance_id,
      controller_lease_expires_at,
      grant_ref
    INTO
      previous_generation,
      previous_state,
      previous_controller,
      previous_lease_expires_at,
      previous_grant_ref
    FROM kernel_equivalence_production_execution_events
   WHERE case_id = NEW.case_id
   ORDER BY generation DESC
   LIMIT 1;

  IF NOT FOUND THEN
    IF NEW.generation <> 1 OR NEW.state <> 'claimed' THEN
      RAISE EXCEPTION
        'kernel equivalence execution must start with a claim';
    END IF;
    SELECT
        cases.expires_at,
        leases.lease_expires_at
      INTO
        case_expires_at,
        production_lease_expires_at
      FROM kernel_equivalence_production_case_leases leases
      JOIN kernel_equivalence_production_cases cases
        ON cases.case_id = leases.case_id
      JOIN harness_attempts attempts
        ON attempts.id = cases.attempt_id
       AND attempts.run_id = cases.run_id
       AND attempts.machine_attestation_status = 'verified'
       AND attempts.status IN ('completed', 'completed_with_concerns')
      JOIN kernel_equivalence_production_case_bindings bindings
        ON bindings.case_id = cases.case_id
       AND bindings.provider_session_id = attempts.provider_session_id
       AND bindings.actual_machine_id = attempts.actual_machine_id
       AND bindings.execution_transport = attempts.execution_transport
       AND bindings.remote_job_id = attempts.remote_job_id
       AND bindings.artifact_sha = cases.artifact_sha
      JOIN harness_result_receipts receipts
        ON receipts.receipt_id = bindings.result_receipt_id
       AND receipts.receipt_id = attempts.result_receipt_id
       AND receipts.attempt_id = attempts.id
       AND receipts.run_id = attempts.run_id
       AND receipts.provider = cases.provider
       AND receipts.requested_provider = cases.provider
       AND receipts.provider_session_id = attempts.provider_session_id
       AND receipts.worker_id = attempts.actual_machine_id
       AND receipts.job_id = attempts.remote_job_id
       AND receipts.terminal_status = attempts.status
       AND receipts.task_bundle_sha256 = bindings.task_bundle_sha256
     WHERE leases.case_id = NEW.case_id
       AND leases.owner_id
             = 'brain.kernel_equivalence.production_cases'
       AND leases.state = 'prepared'
       AND attempts.provider = cases.provider
       AND attempts.execution_transport = 'fleet-worker'
       AND bindings.result_receipt_id = attempts.result_receipt_id
       AND attempts.task_bundle
             #>> '{inputs,workspace_spec,expected_head_sha}'
             = cases.artifact_sha
       AND cases.resource_type = 'ephemeral_run'
       AND cases.resource_id = attempts.id::text
       AND cases.resource_ref =
             cases.resource_prefix || attempts.id::text
     FOR UPDATE OF leases
     FOR SHARE OF cases, attempts, bindings, receipts;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'kernel equivalence production execution claim authority unavailable';
    END IF;
    authority_now := clock_timestamp();
    IF case_expires_at <= authority_now
       OR production_lease_expires_at <= authority_now
       OR NEW.controller_lease_expires_at <= authority_now
       OR NEW.controller_lease_expires_at > LEAST(
         case_expires_at,
         production_lease_expires_at
       ) THEN
      RAISE EXCEPTION
        'kernel equivalence production execution claim authority unavailable';
    END IF;
    SELECT execution_active
      INTO fence_active
      FROM kernel_equivalence_production_execution_fences
     WHERE case_id = NEW.case_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'kernel equivalence production execution claim fence unavailable';
    END IF;
    IF fence_active THEN
      -- A concurrent claim may have committed after this statement snapshot.
      -- Let the unique (case_id, generation) conflict settle it.
      RETURN NEW;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.generation <> previous_generation + 1 THEN
    RAISE EXCEPTION
      'kernel equivalence execution event generation mismatch';
  END IF;

  SELECT grant_ref
    INTO lineage_grant_ref
    FROM kernel_equivalence_production_execution_events
   WHERE case_id = NEW.case_id
     AND grant_ref IS NOT NULL
   ORDER BY generation DESC
   LIMIT 1;

  IF NEW.state IN ('blocked', 'settlement_unknown') THEN
    SELECT
        count(DISTINCT authorities.grant_id),
        COALESCE(bool_or(
          NEW.grant_ref =
            'kernel-equivalence-grant:' || authorities.grant_id::TEXT
          AND authorities.expires_at
                IS NOT DISTINCT FROM NEW.grant_expires_at
        ), false)
      INTO published_grant_count, exact_published_grant
      FROM kernel_equivalence_grant_authorities authorities
      JOIN kernel_equivalence_grant_events grant_events
        ON grant_events.grant_id = authorities.grant_id
       AND grant_events.state = 'published'
     WHERE authorities.case_id = NEW.case_id;
    IF published_grant_count > 0
       AND (
         published_grant_count <> 1
         OR NOT exact_published_grant
       )
    THEN
      RAISE EXCEPTION
        'kernel equivalence settlement requires a unique published grant';
    END IF;
    IF exact_published_grant THEN
      SELECT revocations.execution_disposition
        INTO durable_revocation_disposition
        FROM kernel_equivalence_grant_authorities authorities
        JOIN kernel_equivalence_grant_revocations revocations
          ON revocations.grant_id = authorities.grant_id
         AND revocations.grant_digest = authorities.grant_digest
       WHERE authorities.case_id = NEW.case_id
         AND NEW.grant_ref =
               'kernel-equivalence-grant:'
                 || authorities.grant_id::TEXT
         AND authorities.expires_at
               IS NOT DISTINCT FROM NEW.grant_expires_at;
      IF NOT FOUND
         OR (
           NEW.state = 'blocked'
           AND durable_revocation_disposition <> 'safe_no_effect'
         )
         OR (
           NEW.state = 'settlement_unknown'
           AND durable_revocation_disposition <> 'effect_possible'
         )
      THEN
        RAISE EXCEPTION
          'kernel equivalence settlement requires exact durable grant revocation';
      END IF;
    END IF;
  END IF;

  IF NEW.state = 'executing'
     AND NEW.grant_ref IS DISTINCT FROM previous_grant_ref THEN
    RAISE EXCEPTION
      'kernel equivalence execution grant lineage mismatch';
  END IF;
  IF NEW.state = 'succeeded'
     AND (
       lineage_grant_ref IS NULL
       OR NEW.grant_ref IS NULL
       OR NEW.grant_ref IS DISTINCT FROM lineage_grant_ref
     ) THEN
    RAISE EXCEPTION
      'kernel equivalence execution grant lineage mismatch';
  END IF;
  IF NEW.state IN ('blocked', 'settlement_unknown')
     AND (
       (
         lineage_grant_ref IS NULL
         AND NEW.grant_ref IS NOT NULL
         AND NOT (
           previous_state = 'claimed'
           AND exact_published_grant
         )
       )
       OR (
         lineage_grant_ref IS NOT NULL
         AND NEW.grant_ref IS DISTINCT FROM lineage_grant_ref
       )
     ) THEN
    RAISE EXCEPTION
      'kernel equivalence execution grant lineage mismatch';
  END IF;

  IF NOT (
    (previous_state = 'claimed'
      AND NEW.state IN (
        'grant_issued', 'reconciling', 'blocked', 'settlement_unknown'
      ))
    OR (previous_state = 'grant_issued'
      AND NEW.state IN (
        'executing', 'reconciling', 'succeeded', 'blocked',
        'settlement_unknown'
      ))
    OR (previous_state = 'executing'
      AND NEW.state IN (
        'reconciling', 'succeeded', 'blocked', 'settlement_unknown'
      ))
    OR (previous_state = 'reconciling'
      AND NEW.state IN (
        'reconciling', 'succeeded', 'blocked', 'settlement_unknown'
      ))
    OR (previous_state = 'settlement_unknown'
      AND NEW.state = 'succeeded')
  ) THEN
    RAISE EXCEPTION
      'kernel equivalence execution event transition mismatch';
  END IF;

  SELECT
      cases.expires_at,
      leases.lease_expires_at,
      leases.owner_id,
      leases.state
    INTO
      case_expires_at,
      production_lease_expires_at,
      production_lease_owner,
      production_lease_state
    FROM kernel_equivalence_production_case_leases leases
    JOIN kernel_equivalence_production_cases cases
      ON cases.case_id = leases.case_id
   WHERE leases.case_id = NEW.case_id
   FOR UPDATE OF leases
   FOR SHARE OF cases;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'kernel equivalence production execution authority expiry unavailable';
  END IF;
  authority_now := clock_timestamp();
  IF (
       NEW.controller_lease_expires_at IS NOT NULL
       AND NEW.controller_lease_expires_at > LEAST(
         case_expires_at,
         production_lease_expires_at
       )
     )
     OR (
       NEW.grant_expires_at IS NOT NULL
       AND NEW.grant_expires_at > LEAST(
         case_expires_at,
         production_lease_expires_at
       )
     )
     OR (
       NEW.state IN ('claimed', 'reconciling')
       AND NEW.controller_lease_expires_at <= authority_now
     )
     OR (
       NEW.state IN ('grant_issued', 'executing')
       AND (
         NEW.grant_expires_at <= authority_now
         OR NEW.controller_lease_expires_at <= authority_now
       )
     )
     OR (
       NEW.state = 'reconciling'
       AND (
         production_lease_owner
           IS DISTINCT FROM 'brain.kernel_equivalence.production_cases'
         OR production_lease_state IS DISTINCT FROM 'prepared'
         OR production_lease_expires_at <= authority_now
         OR case_expires_at <= authority_now
       )
     ) THEN
    RAISE EXCEPTION
      'kernel equivalence production execution authority expiry unavailable';
  END IF;

  IF NEW.state IN ('grant_issued', 'executing') THEN
    PERFORM leases.case_id
      FROM kernel_equivalence_production_case_leases leases
      JOIN kernel_equivalence_production_cases cases
        ON cases.case_id = leases.case_id
       AND cases.expires_at > authority_now
      JOIN harness_attempts attempts
        ON attempts.id = cases.attempt_id
       AND attempts.run_id = cases.run_id
       AND attempts.machine_attestation_status = 'verified'
       AND attempts.status IN ('completed', 'completed_with_concerns')
      JOIN kernel_equivalence_production_case_bindings bindings
        ON bindings.case_id = cases.case_id
       AND bindings.provider_session_id = attempts.provider_session_id
       AND bindings.actual_machine_id = attempts.actual_machine_id
       AND bindings.execution_transport = attempts.execution_transport
       AND bindings.remote_job_id = attempts.remote_job_id
       AND bindings.artifact_sha = cases.artifact_sha
      JOIN harness_result_receipts receipts
        ON receipts.receipt_id = bindings.result_receipt_id
       AND receipts.receipt_id = attempts.result_receipt_id
       AND receipts.attempt_id = attempts.id
       AND receipts.run_id = attempts.run_id
       AND receipts.provider = cases.provider
       AND receipts.requested_provider = cases.provider
       AND receipts.provider_session_id = attempts.provider_session_id
       AND receipts.worker_id = attempts.actual_machine_id
       AND receipts.job_id = attempts.remote_job_id
       AND receipts.terminal_status = attempts.status
       AND receipts.task_bundle_sha256 = bindings.task_bundle_sha256
     WHERE leases.case_id = NEW.case_id
       AND leases.owner_id
             = 'brain.kernel_equivalence.production_cases'
       AND leases.state = 'prepared'
       AND leases.lease_expires_at > authority_now
       AND attempts.provider = cases.provider
       AND attempts.execution_transport = 'fleet-worker'
       AND bindings.result_receipt_id = attempts.result_receipt_id
       AND attempts.task_bundle
             #>> '{inputs,workspace_spec,expected_head_sha}'
             = cases.artifact_sha
       AND cases.resource_type = 'ephemeral_run'
       AND cases.resource_id = attempts.id::text
       AND cases.resource_ref =
             cases.resource_prefix || attempts.id::text
       AND NEW.grant_expires_at <= LEAST(
             cases.expires_at,
             leases.lease_expires_at
           )
       AND NEW.grant_expires_at > authority_now
       AND NEW.controller_lease_expires_at <= LEAST(
             cases.expires_at,
             leases.lease_expires_at
           )
       AND NEW.controller_lease_expires_at > authority_now
     FOR UPDATE OF leases
     FOR SHARE OF cases, attempts, bindings, receipts;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'kernel equivalence production execution grant authority unavailable';
    END IF;
  END IF;

  SELECT execution_active
    INTO fence_active
    FROM kernel_equivalence_production_execution_fences
   WHERE case_id = NEW.case_id
   FOR UPDATE;
  IF NOT FOUND
     OR fence_active IS DISTINCT FROM (
       previous_state <> 'settlement_unknown'
     ) THEN
    RAISE EXCEPTION
      'kernel equivalence production execution fence mismatch';
  END IF;

  IF NEW.state = 'succeeded' AND NOT EXISTS (
    SELECT 1
      FROM kernel_equivalence_receipt_bundles bundles
      JOIN kernel_equivalence_production_cases cases
        ON cases.case_id = NEW.case_id
     WHERE bundles.bundle_hash = NEW.bundle_hash
       AND bundles.cell_id = cases.cell_id
       AND bundles.behavior_id = cases.behavior_id
       AND bundles.provider = cases.provider
       AND bundles.scenario = cases.scenario
       AND bundles.run_id = cases.run_id
       AND bundles.attempt_id = cases.attempt_id
       AND bundles.artifact_sha = cases.artifact_sha
       AND bundles.resource_id = cases.resource_id
       AND bundles.resource_ref = cases.resource_ref
       AND bundles.seam_id = cases.seam_id
       AND bundles.adapter_id = cases.adapter_id
       AND NEW.grant_ref =
             'kernel-equivalence-grant:' || bundles.grant_id::text
  ) THEN
    RAISE EXCEPTION
      'kernel equivalence execution settlement readback mismatch';
  END IF;

  IF NEW.controller_instance_id <> previous_controller THEN
    IF NEW.state = 'succeeded' THEN
      NULL; -- Exact durable bundle readback is monotonic across restarts.
    ELSIF NEW.state IN ('blocked', 'settlement_unknown')
       AND previous_state IN (
         'claimed', 'grant_issued', 'executing', 'reconciling'
       )
       AND previous_lease_expires_at <= authority_now
       AND exact_published_grant
       AND (
         (
           NEW.state = 'blocked'
           AND durable_revocation_disposition = 'safe_no_effect'
         )
         OR (
           NEW.state = 'settlement_unknown'
           AND durable_revocation_disposition = 'effect_possible'
         )
       ) THEN
      NULL; -- Expired controller replaced only after exact durable revoke.
    ELSIF NEW.state = 'settlement_unknown'
       AND NEW.code = 'startup_authority_expired'
       AND previous_state IN (
         'claimed', 'grant_issued', 'executing', 'reconciling'
       )
       AND previous_lease_expires_at <= authority_now
       AND LEAST(
         case_expires_at,
         production_lease_expires_at
       ) <= authority_now THEN
      NULL; -- Expired production authority can only release its fence.
    ELSIF NEW.state = 'reconciling'
       AND previous_state IN (
         'claimed', 'grant_issued', 'executing', 'reconciling'
       )
       AND previous_lease_expires_at <= authority_now THEN
      NULL; -- Explicit DB-time lease takeover.
    ELSE
      RAISE EXCEPTION
        'kernel equivalence execution controller ownership mismatch';
    END IF;
  ELSIF NEW.state = 'reconciling' THEN
    RAISE EXCEPTION
      'kernel equivalence execution takeover requires a new controller';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_execution_event_guard
  ON kernel_equivalence_production_execution_events;
CREATE TRIGGER trg_kernel_equivalence_execution_event_guard
  BEFORE INSERT ON kernel_equivalence_production_execution_events
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_execution_event_guard();

CREATE OR REPLACE FUNCTION kernel_equivalence_execution_fence_update_guard()
RETURNS trigger AS $$
DECLARE
  latest_state TEXT;
  expected_active BOOLEAN;
BEGIN
  IF NEW.case_id IS DISTINCT FROM OLD.case_id THEN
    RAISE EXCEPTION
      'kernel equivalence production execution fence identity mismatch';
  END IF;
  SELECT state
    INTO latest_state
    FROM kernel_equivalence_production_execution_events
   WHERE case_id = NEW.case_id
   ORDER BY generation DESC
   LIMIT 1;
  expected_active := COALESCE(
    latest_state IN ('claimed', 'grant_issued', 'executing', 'reconciling'),
    false
  );
  IF NEW.execution_active IS DISTINCT FROM expected_active THEN
    RAISE EXCEPTION
      'kernel equivalence production execution fence state mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_execution_fence_update_guard
  ON kernel_equivalence_production_execution_fences;
CREATE TRIGGER trg_kernel_equivalence_execution_fence_update_guard
  BEFORE UPDATE ON kernel_equivalence_production_execution_fences
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_execution_fence_update_guard();

CREATE OR REPLACE FUNCTION kernel_equivalence_set_execution_fence()
RETURNS trigger AS $$
BEGIN
  UPDATE kernel_equivalence_production_execution_fences
     SET execution_active = NEW.state IN (
       'claimed', 'grant_issued', 'executing', 'reconciling'
     )
   WHERE case_id = NEW.case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'kernel equivalence production execution fence missing';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_set_execution_fence
  ON kernel_equivalence_production_execution_events;
CREATE TRIGGER trg_kernel_equivalence_set_execution_fence
  AFTER INSERT ON kernel_equivalence_production_execution_events
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_set_execution_fence();

CREATE OR REPLACE FUNCTION kernel_equivalence_controller_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'kernel equivalence production controller evidence is append-only (% blocked)',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_execution_fences_no_delete
  ON kernel_equivalence_production_execution_fences;
CREATE TRIGGER trg_kernel_equivalence_execution_fences_no_delete
  BEFORE DELETE ON kernel_equivalence_production_execution_fences
  FOR EACH ROW EXECUTE FUNCTION kernel_equivalence_controller_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_execution_fences_no_truncate
  ON kernel_equivalence_production_execution_fences;
CREATE TRIGGER trg_kernel_equivalence_execution_fences_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_production_execution_fences
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_equivalence_controller_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_case_bindings_append_only
  ON kernel_equivalence_production_case_bindings;
CREATE TRIGGER trg_kernel_equivalence_case_bindings_append_only
  BEFORE UPDATE OR DELETE ON kernel_equivalence_production_case_bindings
  FOR EACH ROW EXECUTE FUNCTION kernel_equivalence_controller_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_case_bindings_no_truncate
  ON kernel_equivalence_production_case_bindings;
CREATE TRIGGER trg_kernel_equivalence_case_bindings_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_production_case_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_equivalence_controller_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_execution_events_append_only
  ON kernel_equivalence_production_execution_events;
CREATE TRIGGER trg_kernel_equivalence_execution_events_append_only
  BEFORE UPDATE OR DELETE ON kernel_equivalence_production_execution_events
  FOR EACH ROW EXECUTE FUNCTION kernel_equivalence_controller_append_only();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_execution_events_no_truncate
  ON kernel_equivalence_production_execution_events;
CREATE TRIGGER trg_kernel_equivalence_execution_events_no_truncate
  BEFORE TRUNCATE ON kernel_equivalence_production_execution_events
  FOR EACH STATEMENT EXECUTE FUNCTION kernel_equivalence_controller_append_only();

INSERT INTO schema_version (version, description)
VALUES ('381', 'kernel_equivalence_production_controller')
ON CONFLICT (version) DO NOTHING;
