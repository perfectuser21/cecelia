-- Migration 380: post-production Kernel ReleaseRun rollback execution.
--
-- Rollback execution is a separate append-only sub-ledger. It consumes an
-- already production_verified ReleaseRun and its exact, durable rollback
-- evidence. It never appends to or changes the forward release transition
-- ledger.

ALTER TABLE kernel_release_effect_dispatch_outcomes
  DROP CONSTRAINT IF EXISTS kernel_release_effect_dispatch_outcomes_outcome_check;
ALTER TABLE kernel_release_effect_dispatch_outcomes
  ADD CONSTRAINT kernel_release_effect_dispatch_outcomes_outcome_check
  CHECK (outcome IN ('dispatched', 'failed', 'observed', 'unknown'));

CREATE TABLE IF NOT EXISTS kernel_release_rollback_execution_authorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_run_id UUID NOT NULL UNIQUE REFERENCES kernel_release_runs(id),
  idempotency_key UUID NOT NULL UNIQUE,
  rollback_intent_id UUID NOT NULL
    REFERENCES kernel_release_rollback_intents(id),
  production_effect_receipt_id UUID NOT NULL
    REFERENCES kernel_release_effect_receipts(id),
  rollback_receipt_id UUID NOT NULL
    REFERENCES kernel_release_rollback_receipts(id),
  expected_merge_sha TEXT NOT NULL CHECK (
    expected_merge_sha ~ '^[0-9a-f]{40}$'
  ),
  expected_artifact_versions JSONB NOT NULL CHECK (
    jsonb_typeof(expected_artifact_versions) = 'array'
    AND jsonb_array_length(expected_artifact_versions) > 0
  ),
  rollback_targets JSONB NOT NULL CHECK (
    jsonb_typeof(rollback_targets) = 'array'
    AND jsonb_array_length(rollback_targets) > 0
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS kernel_release_rollback_execution_claims (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  authority_id UUID NOT NULL UNIQUE
    REFERENCES kernel_release_rollback_execution_authorities(id),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation = 1),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  CHECK (lease_expires_at > claimed_at)
);

CREATE TABLE IF NOT EXISTS kernel_release_rollback_execution_renewals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id BIGINT NOT NULL
    REFERENCES kernel_release_rollback_execution_claims(id),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation = 1),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  renewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (lease_expires_at > renewed_at)
);

CREATE INDEX IF NOT EXISTS idx_kernel_release_rollback_execution_renewals_claim
  ON kernel_release_rollback_execution_renewals
    (claim_id, generation, renewed_at DESC);

CREATE TABLE IF NOT EXISTS kernel_release_rollback_execution_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id UUID NOT NULL UNIQUE
    REFERENCES kernel_release_rollback_execution_authorities(id),
  claim_id BIGINT NOT NULL UNIQUE
    REFERENCES kernel_release_rollback_execution_claims(id),
  settlement_status TEXT NOT NULL CHECK (
    settlement_status IN ('succeeded', 'failed', 'unknown', 'aborted')
  ),
  late_effect_risk BOOLEAN NOT NULL,
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    settlement_status NOT IN ('unknown', 'aborted')
    OR late_effect_risk = TRUE
  )
);

CREATE TABLE IF NOT EXISTS kernel_release_rollback_execution_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id UUID NOT NULL UNIQUE
    REFERENCES kernel_release_rollback_execution_authorities(id),
  settlement_id UUID NOT NULL UNIQUE
    REFERENCES kernel_release_rollback_execution_settlements(id),
  observed_targets JSONB NOT NULL CHECK (
    jsonb_typeof(observed_targets) = 'array'
    AND jsonb_array_length(observed_targets) > 0
  ),
  observed_readbacks JSONB NOT NULL CHECK (
    jsonb_typeof(observed_readbacks) = 'array'
    AND jsonb_array_length(observed_readbacks) > 0
  ),
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- A process signal may arrive after PostgreSQL has accepted COMMIT but before
-- the client receives its result. Preserve that ambiguity as an append-only
-- interrupt instead of returning or observing an unqualified success.
CREATE TABLE IF NOT EXISTS kernel_release_rollback_execution_interrupts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id BIGINT NOT NULL UNIQUE
    REFERENCES kernel_release_rollback_execution_claims(id),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation = 1),
  interrupt_kind TEXT NOT NULL CHECK (
    interrupt_kind IN ('abort_during_commit', 'commit_outcome_unknown')
  ),
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Claim issuance is itself a production mutation boundary. Serialize every
-- production claim (including direct SQL callers) with the same session lock
-- held by forward and rollback controllers, closing the preflight/claim race.
CREATE OR REPLACE FUNCTION
  kernel_release_production_dispatch_claim_mutation_lock()
RETURNS trigger AS $$
BEGIN
  IF NEW.effect_kind = 'production' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('kernel-release/production-mutation/v1', 0)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS
  trg_kernel_release_production_dispatch_claim_mutation_lock
  ON kernel_release_effect_dispatch_claims;
CREATE TRIGGER
  trg_kernel_release_production_dispatch_claim_mutation_lock
  BEFORE INSERT ON kernel_release_effect_dispatch_claims
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_production_dispatch_claim_mutation_lock();

CREATE OR REPLACE FUNCTION kernel_release_rollback_execution_authority_guard()
RETURNS trigger AS $$
DECLARE
  release kernel_release_runs%ROWTYPE;
  latest_state TEXT;
  derived_targets JSONB;
  artifact_count BIGINT;
  distinct_artifact_count BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('kernel-release/rollback/' || NEW.release_run_id::text, 0)
  );

  SELECT *
    INTO release
    FROM kernel_release_runs
   WHERE id = NEW.release_run_id;

  SELECT transition.state
    INTO latest_state
    FROM kernel_release_transitions transition
   WHERE transition.release_run_id = NEW.release_run_id
   ORDER BY transition.append_seq DESC
   LIMIT 1;

  IF release.id IS NULL OR latest_state IS DISTINCT FROM 'production_verified' THEN
    RAISE EXCEPTION
      'latest kernel release transition must be production_verified';
  END IF;

  IF NEW.expected_merge_sha IS DISTINCT FROM release.merge_sha
     OR NEW.expected_artifact_versions IS DISTINCT FROM release.artifact_versions
     OR NOT EXISTS (
       SELECT 1
         FROM kernel_release_effect_intents intent
         JOIN kernel_release_effect_receipts receipt
           ON receipt.intent_id = intent.id
        WHERE intent.release_run_id = release.id
          AND intent.effect_kind = 'production'
          AND intent.expected_merge_sha = release.merge_sha
          AND intent.expected_artifact_versions = release.artifact_versions
          AND receipt.id = NEW.production_effect_receipt_id
          AND receipt.receipt_status = 'confirmed'
          AND receipt.observed_merge_sha = release.merge_sha
          AND receipt.observed_artifact_versions = release.artifact_versions
     )
  THEN
    RAISE EXCEPTION
      'rollback execution authority requires exact confirmed production receipt';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM kernel_release_effect_receipts selected_receipt
      JOIN kernel_release_effect_receipts newer_receipt
        ON newer_receipt.append_seq > selected_receipt.append_seq
       AND newer_receipt.receipt_status = 'confirmed'
      JOIN kernel_release_effect_intents newer_intent
        ON newer_intent.id = newer_receipt.intent_id
       AND newer_intent.effect_kind = 'production'
     WHERE selected_receipt.id = NEW.production_effect_receipt_id
  ) THEN
    RAISE EXCEPTION
      'rollback execution authority requires latest confirmed production receipt';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM kernel_release_rollback_intents rollback_intent
      JOIN kernel_release_rollback_receipts rollback_receipt
        ON rollback_receipt.rollback_intent_id = rollback_intent.id
      JOIN kernel_release_effect_receipts receipt
        ON receipt.id = rollback_receipt.effect_receipt_id
     WHERE rollback_intent.id = NEW.rollback_intent_id
       AND rollback_intent.release_run_id = release.id
       AND rollback_intent.expected_merge_sha = release.merge_sha
       AND rollback_intent.expected_artifact_versions =
           release.artifact_versions
       AND rollback_receipt.id = NEW.rollback_receipt_id
       AND rollback_receipt.effect_receipt_id =
           NEW.production_effect_receipt_id
       AND receipt.receipt_status = 'confirmed'
       AND receipt.observed_merge_sha = release.merge_sha
       AND receipt.observed_artifact_versions = release.artifact_versions
       AND rollback_receipt.anchor =
           receipt.evidence#>>'{verification,rollback_metadata,anchor}'
       AND rollback_receipt.previous_version =
           receipt.evidence#>>'{verification,rollback_metadata,previous_version}'
       AND rollback_receipt.rollback_metadata =
           receipt.evidence#>'{verification,rollback_metadata}'
  ) THEN
    RAISE EXCEPTION
      'rollback execution authority requires exact aggregate rollback receipt';
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'artifact_name', artifact_intent.artifact_name,
             'current_version', artifact_intent.expected_current_version,
             'current_digest', artifact_intent.expected_current_digest,
             'anchor', artifact_receipt.observed_anchor,
             'previous_version', artifact_receipt.observed_previous_version,
             'previous_digest', artifact_receipt.observed_previous_digest,
             'rollback_metadata', artifact_receipt.rollback_metadata
           )
           ORDER BY artifact_intent.artifact_name
         ),
         COUNT(*),
         COUNT(DISTINCT artifact_intent.artifact_name)
    INTO derived_targets, artifact_count, distinct_artifact_count
    FROM kernel_release_rollback_artifact_intents artifact_intent
    JOIN kernel_release_rollback_artifact_receipts artifact_receipt
      ON artifact_receipt.rollback_artifact_intent_id = artifact_intent.id
     AND artifact_receipt.effect_receipt_id =
         NEW.production_effect_receipt_id
     AND artifact_receipt.observed_anchor =
         artifact_intent.expected_anchor
     AND artifact_receipt.observed_previous_version =
         artifact_intent.expected_previous_version
     AND artifact_receipt.observed_previous_digest =
         artifact_intent.expected_previous_digest
    JOIN LATERAL jsonb_array_elements(release.artifact_versions) artifact
      ON artifact->>'name' = artifact_intent.artifact_name
     AND artifact->>'version' = artifact_intent.expected_current_version
     AND artifact->>'digest' = artifact_intent.expected_current_digest
    JOIN kernel_release_effect_receipts receipt
      ON receipt.id = NEW.production_effect_receipt_id
     AND receipt.receipt_status = 'confirmed'
    JOIN LATERAL jsonb_array_elements(
      receipt.evidence#>'{verification,rollback_artifacts}'
    ) observed
      ON observed->>'artifact_name' = artifact_intent.artifact_name
     AND observed->>'current_version' =
         artifact_intent.expected_current_version
     AND observed->>'current_digest' =
         artifact_intent.expected_current_digest
     AND observed->>'anchor' = artifact_intent.expected_anchor
     AND observed->>'previous_version' =
         artifact_intent.expected_previous_version
     AND observed->>'previous_digest' =
         artifact_intent.expected_previous_digest
     AND observed->'rollback_metadata' = artifact_receipt.rollback_metadata
   WHERE artifact_intent.rollback_intent_id = NEW.rollback_intent_id;

  IF artifact_count IS DISTINCT FROM
       jsonb_array_length(release.artifact_versions)
     OR distinct_artifact_count IS DISTINCT FROM
       jsonb_array_length(release.artifact_versions)
     OR derived_targets IS DISTINCT FROM NEW.rollback_targets
  THEN
    RAISE EXCEPTION
      'rollback execution authority requires complete exact artifact rollback targets';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_rollback_execution_authority_guard
  ON kernel_release_rollback_execution_authorities;
CREATE TRIGGER trg_kernel_release_rollback_execution_authority_guard
  BEFORE INSERT ON kernel_release_rollback_execution_authorities
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_rollback_execution_authority_guard();

CREATE OR REPLACE FUNCTION kernel_release_rollback_execution_claim_guard()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('kernel-release/rollback/' || NEW.authority_id::text, 0)
  );
  IF NEW.generation IS DISTINCT FROM 1
     OR NEW.lease_expires_at <= clock_timestamp()
     OR NOT EXISTS (
       SELECT 1
         FROM kernel_release_rollback_execution_authorities authority
        WHERE authority.id = NEW.authority_id
     )
     OR EXISTS (
       SELECT 1
         FROM kernel_release_rollback_execution_authorities authority
         JOIN kernel_release_effect_receipts production_receipt
           ON production_receipt.id =
              authority.production_effect_receipt_id
        WHERE authority.id = NEW.authority_id
          AND (
            production_receipt.dispatch_claim_id IS NULL
            OR EXISTS (
              SELECT 1
                FROM kernel_release_effect_receipts newer_receipt
               WHERE newer_receipt.receipt_status = 'confirmed'
                 AND newer_receipt.append_seq >
                     production_receipt.append_seq
            )
            OR EXISTS (
              SELECT 1
                FROM kernel_release_effect_dispatch_claims newer_claim
                JOIN kernel_release_effect_intents newer_intent
                  ON newer_intent.id = newer_claim.intent_id
               WHERE newer_intent.effect_kind = 'production'
                 AND newer_claim.id >
                     production_receipt.dispatch_claim_id
            )
          )
     )
     OR EXISTS (
       SELECT 1
         FROM kernel_release_rollback_execution_settlements settlement
        WHERE settlement.authority_id = NEW.authority_id
     )
  THEN
    RAISE EXCEPTION 'rollback execution claim is not live';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_rollback_execution_claim_guard
  ON kernel_release_rollback_execution_claims;
CREATE TRIGGER trg_kernel_release_rollback_execution_claim_guard
  BEFORE INSERT ON kernel_release_rollback_execution_claims
  FOR EACH ROW EXECUTE FUNCTION kernel_release_rollback_execution_claim_guard();

CREATE OR REPLACE FUNCTION kernel_release_rollback_execution_renewal_guard()
RETURNS trigger AS $$
DECLARE
  effective_lease_expires_at TIMESTAMPTZ;
  claim_authority_id UUID;
BEGIN
  SELECT claim.authority_id
    INTO claim_authority_id
    FROM kernel_release_rollback_execution_claims claim
   WHERE claim.id = NEW.claim_id
     AND claim.generation = NEW.generation;
  IF claim_authority_id IS NULL THEN
    RAISE EXCEPTION 'rollback execution claim is not live';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('kernel-release/rollback/' || claim_authority_id::text, 0)
  );

  SELECT claim.authority_id,
         GREATEST(
           claim.lease_expires_at,
           COALESCE(MAX(renewal.lease_expires_at), claim.lease_expires_at)
         )
    INTO claim_authority_id, effective_lease_expires_at
    FROM kernel_release_rollback_execution_claims claim
    LEFT JOIN kernel_release_rollback_execution_renewals renewal
      ON renewal.claim_id = claim.id
     AND renewal.generation = claim.generation
   WHERE claim.id = NEW.claim_id
     AND claim.generation = NEW.generation
   GROUP BY claim.id;

  IF claim_authority_id IS NULL
     OR effective_lease_expires_at <= clock_timestamp()
     OR NEW.lease_expires_at <= clock_timestamp()
     OR EXISTS (
       SELECT 1
         FROM kernel_release_rollback_execution_settlements settlement
        WHERE settlement.authority_id = claim_authority_id
     )
  THEN
    RAISE EXCEPTION 'rollback execution claim is not live';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_rollback_execution_renewal_guard
  ON kernel_release_rollback_execution_renewals;
CREATE TRIGGER trg_kernel_release_rollback_execution_renewal_guard
  BEFORE INSERT ON kernel_release_rollback_execution_renewals
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_rollback_execution_renewal_guard();

CREATE OR REPLACE FUNCTION kernel_release_rollback_execution_settlement_guard()
RETURNS trigger AS $$
DECLARE
  effective_lease_expires_at TIMESTAMPTZ;
  exact_authority_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('kernel-release/rollback/' || NEW.authority_id::text, 0)
  );
  SELECT claim.authority_id,
         GREATEST(
           claim.lease_expires_at,
           COALESCE(MAX(renewal.lease_expires_at), claim.lease_expires_at)
         )
    INTO exact_authority_id, effective_lease_expires_at
    FROM kernel_release_rollback_execution_claims claim
    LEFT JOIN kernel_release_rollback_execution_renewals renewal
      ON renewal.claim_id = claim.id
     AND renewal.generation = claim.generation
   WHERE claim.id = NEW.claim_id
     AND claim.generation = 1
   GROUP BY claim.id;

  IF exact_authority_id IS NULL
     OR NEW.authority_id IS DISTINCT FROM exact_authority_id
     OR (
       NEW.settlement_status = 'succeeded'
       AND effective_lease_expires_at <= clock_timestamp()
     )
     OR (
       NEW.settlement_status = 'unknown'
       AND NEW.evidence->>'source' =
           'release_rollback_expired_claim_reaper'
       AND effective_lease_expires_at > clock_timestamp()
     )
  THEN
    RAISE EXCEPTION 'rollback execution settlement is fenced';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_rollback_execution_settlement_guard
  ON kernel_release_rollback_execution_settlements;
CREATE TRIGGER trg_kernel_release_rollback_execution_settlement_guard
  BEFORE INSERT ON kernel_release_rollback_execution_settlements
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_rollback_execution_settlement_guard();

CREATE OR REPLACE FUNCTION kernel_release_rollback_execution_receipt_guard()
RETURNS trigger AS $$
DECLARE
  expected_count INTEGER;
  matched_count INTEGER;
  distinct_count INTEGER;
BEGIN
  SELECT jsonb_array_length(authority.rollback_targets)
    INTO expected_count
    FROM kernel_release_rollback_execution_settlements settlement
    JOIN kernel_release_rollback_execution_authorities authority
      ON authority.id = settlement.authority_id
   WHERE settlement.id = NEW.settlement_id
     AND settlement.authority_id = NEW.authority_id
     AND settlement.settlement_status = 'succeeded'
     AND NEW.observed_targets = authority.rollback_targets;

  SELECT COUNT(*), COUNT(DISTINCT readback->>'artifact')
    INTO matched_count, distinct_count
    FROM jsonb_array_elements(NEW.observed_readbacks) readback
    JOIN jsonb_array_elements(NEW.observed_targets) target
      ON readback->>'artifact' = target->>'artifact_name'
     AND readback->>'observed_digest' = target->>'previous_digest'
   WHERE jsonb_typeof(readback) = 'object'
     AND readback ? 'artifact'
     AND readback ? 'observed_digest';

  IF expected_count IS NULL
     OR matched_count IS DISTINCT FROM expected_count
     OR distinct_count IS DISTINCT FROM expected_count
     OR jsonb_array_length(NEW.observed_readbacks) IS DISTINCT FROM expected_count
  THEN
    RAISE EXCEPTION 'execution receipt requires exact rollback target readbacks';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM kernel_release_rollback_execution_settlements settlement
      JOIN kernel_release_rollback_execution_authorities authority
        ON authority.id = settlement.authority_id
     WHERE settlement.id = NEW.settlement_id
       AND settlement.authority_id = NEW.authority_id
       AND settlement.settlement_status = 'succeeded'
       AND NEW.observed_targets = authority.rollback_targets
  ) THEN
    RAISE EXCEPTION 'execution receipt requires exact rollback targets';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kernel_release_rollback_execution_receipt_guard
  ON kernel_release_rollback_execution_receipts;
CREATE TRIGGER trg_kernel_release_rollback_execution_receipt_guard
  BEFORE INSERT ON kernel_release_rollback_execution_receipts
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_rollback_execution_receipt_guard();

CREATE OR REPLACE FUNCTION
  kernel_release_rollback_execution_success_receipt_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.settlement_status = 'succeeded' AND NOT EXISTS (
    SELECT 1
      FROM kernel_release_rollback_execution_receipts receipt
      JOIN kernel_release_rollback_execution_authorities authority
        ON authority.id = receipt.authority_id
     WHERE receipt.settlement_id = NEW.id
       AND receipt.authority_id = NEW.authority_id
       AND receipt.observed_targets = authority.rollback_targets
  ) THEN
    RAISE EXCEPTION
      'succeeded rollback settlement requires exact execution receipt';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_success_receipt_guard
  ON kernel_release_rollback_execution_settlements;
CREATE CONSTRAINT TRIGGER
  trg_kernel_release_rollback_execution_success_receipt_guard
  AFTER INSERT ON kernel_release_rollback_execution_settlements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_rollback_execution_success_receipt_guard();

CREATE OR REPLACE FUNCTION kernel_release_rollback_execution_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'kernel release rollback execution ledger is append-only (% blocked)',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_authorities_append_only
  ON kernel_release_rollback_execution_authorities;
CREATE TRIGGER trg_kernel_release_rollback_execution_authorities_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_rollback_execution_authorities
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_claims_append_only
  ON kernel_release_rollback_execution_claims;
CREATE TRIGGER trg_kernel_release_rollback_execution_claims_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_rollback_execution_claims
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_renewals_append_only
  ON kernel_release_rollback_execution_renewals;
CREATE TRIGGER trg_kernel_release_rollback_execution_renewals_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_rollback_execution_renewals
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_settlements_append_only
  ON kernel_release_rollback_execution_settlements;
CREATE TRIGGER trg_kernel_release_rollback_execution_settlements_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_rollback_execution_settlements
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_receipts_append_only
  ON kernel_release_rollback_execution_receipts;
CREATE TRIGGER trg_kernel_release_rollback_execution_receipts_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_rollback_execution_receipts
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_interrupts_append_only
  ON kernel_release_rollback_execution_interrupts;
CREATE TRIGGER trg_kernel_release_rollback_execution_interrupts_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_rollback_execution_interrupts
  FOR EACH ROW EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_authorities_truncate
  ON kernel_release_rollback_execution_authorities;
CREATE TRIGGER trg_kernel_release_rollback_execution_authorities_truncate
  BEFORE TRUNCATE ON kernel_release_rollback_execution_authorities
  FOR EACH STATEMENT EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_claims_truncate
  ON kernel_release_rollback_execution_claims;
CREATE TRIGGER trg_kernel_release_rollback_execution_claims_truncate
  BEFORE TRUNCATE ON kernel_release_rollback_execution_claims
  FOR EACH STATEMENT EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_renewals_truncate
  ON kernel_release_rollback_execution_renewals;
CREATE TRIGGER trg_kernel_release_rollback_execution_renewals_truncate
  BEFORE TRUNCATE ON kernel_release_rollback_execution_renewals
  FOR EACH STATEMENT EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_settlements_truncate
  ON kernel_release_rollback_execution_settlements;
CREATE TRIGGER trg_kernel_release_rollback_execution_settlements_truncate
  BEFORE TRUNCATE ON kernel_release_rollback_execution_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_receipts_truncate
  ON kernel_release_rollback_execution_receipts;
CREATE TRIGGER trg_kernel_release_rollback_execution_receipts_truncate
  BEFORE TRUNCATE ON kernel_release_rollback_execution_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

DROP TRIGGER IF EXISTS
  trg_kernel_release_rollback_execution_interrupts_truncate
  ON kernel_release_rollback_execution_interrupts;
CREATE TRIGGER trg_kernel_release_rollback_execution_interrupts_truncate
  BEFORE TRUNCATE ON kernel_release_rollback_execution_interrupts
  FOR EACH STATEMENT EXECUTE FUNCTION
    kernel_release_rollback_execution_append_only();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('380', 'Kernel ReleaseRun post-production rollback execution', NOW())
ON CONFLICT (version) DO NOTHING;
