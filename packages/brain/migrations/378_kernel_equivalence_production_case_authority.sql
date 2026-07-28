-- Migration 378: additive authority upgrade for production equivalence cases.
--
-- Migration 377 may already be registered, so none of these protections may
-- depend on re-running or rewriting that migration. Audit legacy rows first,
-- add and validate the canonical tuple constraint, then backport the initial
-- lease and atomic lifecycle guards. Every operation is safe to rerun.

LOCK TABLE
  kernel_equivalence_production_cases,
  kernel_equivalence_production_case_leases,
  kernel_equivalence_production_case_events
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM kernel_equivalence_production_cases
     WHERE (behavior_id, seam_id, adapter_id, resource_type) NOT IN (
       ('KERNEL-P0-01-BRANCH-PROTECTION',
        'kernel.workspace.protected_ref_guard',
        'kernel.drill.branch_protection.v1', 'ephemeral_branch'),
       ('KERNEL-P0-02-CREDENTIAL-GUARD',
        'kernel.credential.attempt_lease',
        'kernel.drill.credential_guard.v1', 'ephemeral_credential_lease'),
       ('KERNEL-P0-03-BRANCH-PUSH-GUARD',
        'kernel.github.mutation_broker',
        'kernel.drill.branch_push_guard.v1', 'ephemeral_branch'),
       ('KERNEL-P0-04-CI-MERGE-AUTHORITY',
        'kernel.merge.effect_executor',
        'kernel.drill.ci_merge_authority.v1', 'ephemeral_branch'),
       ('KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE',
        'kernel.evaluation.independent_judge',
        'kernel.drill.independent_evaluator_judge.v1', 'ephemeral_run'),
       ('KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY',
        'kernel.merge.human_review_authority',
        'kernel.drill.human_review_authority.v1', 'ephemeral_run'),
       ('KERNEL-P0-07-RELEASE-PROMOTION',
        'kernel.release.staging_promotion',
        'kernel.drill.release_promotion.v1', 'ephemeral_staging'),
       ('KERNEL-P1-08-STOP-ORPHAN-LIVENESS',
        'kernel.liveness.orphan_recovery',
        'kernel.drill.stop_orphan_liveness.v1', 'ephemeral_run'),
       ('KERNEL-P1-09-DEVGATE-TDD-DOD',
        'kernel.quality.devgate',
        'kernel.drill.devgate_tdd_dod.v1', 'ephemeral_workspace'),
       ('KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION',
        'kernel.controller.attempt_ownership',
        'kernel.drill.controller_session_isolation.v1', 'ephemeral_run'),
       ('KERNEL-P1-11-REPORT-LEARNING-CLOSURE',
        'kernel.closure.report_learning',
        'kernel.drill.report_learning_closure.v1',
        'ephemeral_database_record')
     )
  ) THEN
    RAISE EXCEPTION
      'kernel equivalence production cases contain a non-canonical behavior tuple';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    WITH canonical_lifecycle AS (
      SELECT
        case_id,
        generation,
        CASE event_type
          WHEN 'prepared' THEN 'prepared'
          WHEN 'cancel_requested' THEN 'cancelling'
          WHEN 'cancel_confirmed' THEN 'cancelled'
          WHEN 'cleanup_confirmed' THEN 'cleaned'
          WHEN 'cleanup_unconfirmed' THEN 'cleanup_unconfirmed'
          ELSE NULL
        END AS event_state
        FROM kernel_equivalence_production_case_events
       WHERE (
         event_type = 'prepared'
         AND generation = 1
         AND status = 'confirmed'
         AND late_effect_risk = false
       ) OR (
         event_type = 'cancel_requested'
         AND status = 'confirmed'
         AND late_effect_risk = false
       ) OR (
         event_type = 'cancel_confirmed'
         AND status = 'confirmed'
         AND late_effect_risk = false
       ) OR (
         event_type = 'cleanup_confirmed'
         AND status = 'confirmed'
         AND late_effect_risk = false
       ) OR (
         event_type = 'cleanup_unconfirmed'
         AND status = 'unconfirmed'
         AND late_effect_risk = true
       )
    ),
    lifecycle_rollup AS (
      SELECT
        case_id,
        count(*) AS event_count,
        min(generation) AS first_generation,
        max(generation) AS last_generation,
        (array_agg(event_state ORDER BY generation))[1] AS first_state,
        (array_agg(event_state ORDER BY generation DESC))[1] AS last_state
        FROM canonical_lifecycle
       GROUP BY case_id
    )
    SELECT 1
      FROM kernel_equivalence_production_cases cases
      LEFT JOIN kernel_equivalence_production_case_leases leases
        USING (case_id)
      LEFT JOIN lifecycle_rollup lifecycle
        USING (case_id)
     WHERE leases.case_id IS NULL
        OR leases.owner_id
             <> 'brain.kernel_equivalence.production_cases'
        OR leases.lease_expires_at > cases.expires_at
        OR lifecycle.case_id IS NULL
        OR lifecycle.event_count <> leases.generation
        OR lifecycle.first_generation <> 1
        OR lifecycle.last_generation <> leases.generation
        OR lifecycle.first_state <> 'prepared'
        OR lifecycle.last_state <> leases.state
  ) THEN
    RAISE EXCEPTION
      'kernel equivalence ledger contains invalid production case lifecycle';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'kernel_equivalence_production_cases'::regclass
       AND conname =
         'ck_kernel_equivalence_production_case_canonical_tuple'
  ) THEN
    ALTER TABLE kernel_equivalence_production_cases
      ADD CONSTRAINT
        ck_kernel_equivalence_production_case_canonical_tuple
      CHECK ((behavior_id, seam_id, adapter_id, resource_type) IN (
        ('KERNEL-P0-01-BRANCH-PROTECTION',
         'kernel.workspace.protected_ref_guard',
         'kernel.drill.branch_protection.v1', 'ephemeral_branch'),
        ('KERNEL-P0-02-CREDENTIAL-GUARD',
         'kernel.credential.attempt_lease',
         'kernel.drill.credential_guard.v1', 'ephemeral_credential_lease'),
        ('KERNEL-P0-03-BRANCH-PUSH-GUARD',
         'kernel.github.mutation_broker',
         'kernel.drill.branch_push_guard.v1', 'ephemeral_branch'),
        ('KERNEL-P0-04-CI-MERGE-AUTHORITY',
         'kernel.merge.effect_executor',
         'kernel.drill.ci_merge_authority.v1', 'ephemeral_branch'),
        ('KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE',
         'kernel.evaluation.independent_judge',
         'kernel.drill.independent_evaluator_judge.v1', 'ephemeral_run'),
        ('KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY',
         'kernel.merge.human_review_authority',
         'kernel.drill.human_review_authority.v1', 'ephemeral_run'),
        ('KERNEL-P0-07-RELEASE-PROMOTION',
         'kernel.release.staging_promotion',
         'kernel.drill.release_promotion.v1', 'ephemeral_staging'),
        ('KERNEL-P1-08-STOP-ORPHAN-LIVENESS',
         'kernel.liveness.orphan_recovery',
         'kernel.drill.stop_orphan_liveness.v1', 'ephemeral_run'),
        ('KERNEL-P1-09-DEVGATE-TDD-DOD',
         'kernel.quality.devgate',
         'kernel.drill.devgate_tdd_dod.v1', 'ephemeral_workspace'),
        ('KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION',
         'kernel.controller.attempt_ownership',
         'kernel.drill.controller_session_isolation.v1', 'ephemeral_run'),
        ('KERNEL-P1-11-REPORT-LEARNING-CLOSURE',
         'kernel.closure.report_learning',
         'kernel.drill.report_learning_closure.v1',
         'ephemeral_database_record')
      )) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE kernel_equivalence_production_cases
  VALIDATE CONSTRAINT
    ck_kernel_equivalence_production_case_canonical_tuple;

CREATE OR REPLACE FUNCTION kernel_equivalence_case_lease_advance_guard()
RETURNS trigger AS $$
DECLARE
  case_expires_at TIMESTAMPTZ;
BEGIN
  SELECT expires_at
    INTO case_expires_at
    FROM kernel_equivalence_production_cases
   WHERE case_id = NEW.case_id;

  IF NEW.case_id <> OLD.case_id
     OR NEW.owner_id <> OLD.owner_id
     OR NEW.generation <> OLD.generation + 1
     OR NEW.updated_at <= OLD.updated_at
     OR NEW.updated_at > clock_timestamp() + interval '1 second'
     OR NOT FOUND THEN
    RAISE EXCEPTION
      'kernel equivalence production case lease advance is invalid';
  END IF;

  IF NEW.lease_expires_at > case_expires_at THEN
    RAISE EXCEPTION
      'kernel equivalence production case lease exceeds case expiry';
  END IF;

  IF NEW.state NOT IN ('cleanup_unconfirmed', 'cleaned')
     AND NEW.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION
      'kernel equivalence production case lease is expired';
  END IF;

  IF NOT (
    (OLD.state = 'prepared'
      AND NEW.state IN ('cancelling', 'cleanup_unconfirmed', 'cleaned'))
    OR (OLD.state = 'cancelling'
      AND NEW.state IN ('cancelled', 'cleanup_unconfirmed', 'cleaned'))
    OR (OLD.state = 'cancelled'
      AND NEW.state IN ('cleanup_unconfirmed', 'cleaned'))
    OR (OLD.state = 'cleanup_unconfirmed'
      AND NEW.state IN ('cancelling', 'cleaned'))
  ) THEN
    RAISE EXCEPTION
      'kernel equivalence production case lease transition is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kernel_equivalence_case_lease_insert_guard()
RETURNS trigger AS $$
DECLARE
  case_expires_at TIMESTAMPTZ;
BEGIN
  SELECT expires_at
    INTO case_expires_at
    FROM kernel_equivalence_production_cases
   WHERE case_id = NEW.case_id;

  IF NOT FOUND
     OR NEW.owner_id <> 'brain.kernel_equivalence.production_cases'
     OR NEW.generation <> 1
     OR NEW.state <> 'prepared'
     OR NEW.lease_expires_at <= clock_timestamp()
     OR NEW.lease_expires_at > case_expires_at
     OR NEW.updated_at > clock_timestamp() + interval '1 second' THEN
    RAISE EXCEPTION
      'kernel equivalence production case lease insert is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kernel_equivalence_case_event_guard()
RETURNS trigger AS $$
DECLARE
  lease_generation BIGINT;
  lease_state TEXT;
BEGIN
  SELECT generation, state
    INTO lease_generation, lease_state
    FROM kernel_equivalence_production_case_leases
   WHERE case_id = NEW.case_id;

  IF NOT FOUND
     OR NEW.generation <> lease_generation THEN
    RAISE EXCEPTION
      'kernel equivalence production case event/lease generation mismatch';
  END IF;

  IF NOT (
    (NEW.event_type = 'prepared'
      AND NEW.generation = 1
      AND lease_state = 'prepared'
      AND NEW.status = 'confirmed'
      AND NEW.late_effect_risk = false)
    OR (NEW.event_type = 'cancel_requested'
      AND lease_state = 'cancelling'
      AND NEW.status = 'confirmed'
      AND NEW.late_effect_risk = false)
    OR (NEW.event_type = 'cancel_confirmed'
      AND lease_state = 'cancelled'
      AND NEW.status = 'confirmed'
      AND NEW.late_effect_risk = false)
    OR (NEW.event_type = 'cleanup_confirmed'
      AND lease_state = 'cleaned'
      AND NEW.status = 'confirmed'
      AND NEW.late_effect_risk = false)
    OR (NEW.event_type = 'cleanup_unconfirmed'
      AND lease_state = 'cleanup_unconfirmed'
      AND NEW.status = 'unconfirmed'
      AND NEW.late_effect_risk = true)
    OR (NEW.event_type = 'inspection'
      AND NEW.status IN ('confirmed', 'unconfirmed')
      AND NEW.late_effect_risk = (NEW.status = 'unconfirmed'))
  ) THEN
    RAISE EXCEPTION
      'kernel equivalence production case event/lease state mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kernel_equivalence_case_lifecycle_guard()
RETURNS trigger AS $$
DECLARE
  guarded_case_id UUID;
  required_generation BIGINT;
  required_state TEXT;
BEGIN
  guarded_case_id := NEW.case_id;
  IF TG_TABLE_NAME = 'kernel_equivalence_production_cases'
     OR TG_OP = 'INSERT' THEN
    required_generation := 1;
    required_state := 'prepared';
    IF NOT EXISTS (
      SELECT 1
        FROM kernel_equivalence_production_case_leases
       WHERE case_id = guarded_case_id
         AND owner_id = 'brain.kernel_equivalence.production_cases'
    ) THEN
      RAISE EXCEPTION
        'kernel equivalence production case lease event is missing';
    END IF;
  ELSE
    required_generation := NEW.generation;
    required_state := NEW.state;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM kernel_equivalence_production_case_events
     WHERE case_id = guarded_case_id
       AND generation = required_generation
       AND (
         (required_state = 'prepared'
          AND event_type = 'prepared'
          AND status = 'confirmed'
          AND late_effect_risk = false)
         OR (required_state = 'cancelling'
          AND event_type = 'cancel_requested'
          AND status = 'confirmed'
          AND late_effect_risk = false)
         OR (required_state = 'cancelled'
          AND event_type = 'cancel_confirmed'
          AND status = 'confirmed'
          AND late_effect_risk = false)
         OR (required_state = 'cleaned'
          AND event_type = 'cleanup_confirmed'
          AND status = 'confirmed'
          AND late_effect_risk = false)
         OR (required_state = 'cleanup_unconfirmed'
          AND event_type = 'cleanup_unconfirmed'
          AND status = 'unconfirmed'
          AND late_effect_risk = true)
       )
  ) THEN
    RAISE EXCEPTION
      'kernel equivalence production case lease event is missing';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_equivalence_case_event_guard
  ON kernel_equivalence_production_case_events;
CREATE TRIGGER trg_kernel_equivalence_case_event_guard
  BEFORE INSERT ON kernel_equivalence_production_case_events
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_case_event_guard();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_case_lease_insert_guard
  ON kernel_equivalence_production_case_leases;
CREATE TRIGGER trg_kernel_equivalence_case_lease_insert_guard
  BEFORE INSERT ON kernel_equivalence_production_case_leases
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_case_lease_insert_guard();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_case_requires_lifecycle
  ON kernel_equivalence_production_cases;
CREATE CONSTRAINT TRIGGER trg_kernel_equivalence_case_requires_lifecycle
  AFTER INSERT ON kernel_equivalence_production_cases
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_case_lifecycle_guard();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_lease_requires_event
  ON kernel_equivalence_production_case_leases;
CREATE CONSTRAINT TRIGGER trg_kernel_equivalence_lease_requires_event
  AFTER INSERT OR UPDATE ON kernel_equivalence_production_case_leases
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_case_lifecycle_guard();

DROP TRIGGER IF EXISTS trg_kernel_equivalence_case_lease_advance_guard
  ON kernel_equivalence_production_case_leases;
CREATE TRIGGER trg_kernel_equivalence_case_lease_advance_guard
  BEFORE UPDATE ON kernel_equivalence_production_case_leases
  FOR EACH ROW
  EXECUTE FUNCTION kernel_equivalence_case_lease_advance_guard();

INSERT INTO schema_version (version, description)
VALUES ('378', 'kernel_equivalence_production_case_authority')
ON CONFLICT (version) DO NOTHING;
