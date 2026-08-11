-- Migration 409: Gap Ledger，并加厚既有 task_dependencies

CREATE OR REPLACE FUNCTION harness_assertion_command_argv(command_text TEXT)
RETURNS JSONB AS $$
BEGIN
  IF command_text ~ '^npx vitest run [A-Za-z0-9_./@+-]+$' THEN
    RETURN jsonb_build_array(
      'npx', 'vitest', 'run', substring(command_text FROM 16)
    );
  ELSIF command_text ~ '^python3 -m pytest [A-Za-z0-9_./@+-]+$' THEN
    RETURN jsonb_build_array(
      'python3', '-m', 'pytest', substring(command_text FROM 19)
    );
  ELSIF command_text ~ '^bash [A-Za-z0-9_./@+-]+$' THEN
    RETURN jsonb_build_array('bash', substring(command_text FROM 6));
  END IF;
  RAISE EXCEPTION 'non-canonical harness assertion command'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE TABLE IF NOT EXISTS harness_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  repair_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  impact_node_id TEXT NOT NULL,
  owner TEXT,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'assigned', 'fixing', 'verifying', 'resolved', 'reopened', 'triage')),
  current_revision TEXT,
  resolution_evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_harness_gaps_revision
    UNIQUE NULLS NOT DISTINCT (source_task_id, impact_node_id, current_revision)
);

CREATE TABLE IF NOT EXISTS gap_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gap_id UUID NOT NULL REFERENCES harness_gaps(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'discovered', 'assigned', 'fix_started', 'verification_started',
      'resolved', 'reopened', 'CONTRACT_IMPACT_DRIFT'
    )),
  idempotency_key TEXT NOT NULL,
  actor TEXT,
  detail JSONB,
  revision TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gap_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS harness_gap_dependencies (
  gap_id UUID PRIMARY KEY REFERENCES harness_gaps(id) ON DELETE CASCADE,
  source_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  repair_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'satisfied', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE task_dependencies
  ADD COLUMN IF NOT EXISTS gap_id UUID REFERENCES harness_gaps(id),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'satisfied';

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS impact_contract_policy TEXT NOT NULL DEFAULT 'legacy_exempt',
  ADD COLUMN IF NOT EXISTS impact_contract_policy_reason TEXT,
  ADD COLUMN IF NOT EXISTS impact_contract_policy_decision_id TEXT;

ALTER TABLE journey_assertion_receipts
  ADD COLUMN IF NOT EXISTS impact_contract_id UUID REFERENCES harness_impact_contracts(id),
  ADD COLUMN IF NOT EXISTS impact_contract_hash TEXT,
  ADD COLUMN IF NOT EXISTS harness_attempt_id UUID REFERENCES harness_attempts(id);

ALTER TABLE journey_assertion_receipts
  DROP CONSTRAINT IF EXISTS journey_assertion_receipts_run_id_journey_step_link_id_key;
ALTER TABLE journey_assertion_receipts
  DROP CONSTRAINT IF EXISTS journey_assertion_receipts_run_link_source_impact_key;
ALTER TABLE journey_assertion_receipts
  ADD CONSTRAINT journey_assertion_receipts_run_link_source_impact_key
  UNIQUE NULLS NOT DISTINCT (
    run_id, journey_step_link_id, source_sha, impact_contract_hash
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'task_dependencies'::regclass
      AND conname = 'task_dependencies_status_check'
  ) THEN
    ALTER TABLE task_dependencies
      ADD CONSTRAINT task_dependencies_status_check
      CHECK (status IN ('pending', 'satisfied', 'cancelled'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'initiative_runs'::regclass
      AND conname = 'initiative_runs_impact_contract_policy_check'
  ) THEN
    ALTER TABLE initiative_runs
      ADD CONSTRAINT initiative_runs_impact_contract_policy_check
      CHECK (impact_contract_policy IN ('required', 'exempt', 'legacy_exempt'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'journey_assertion_receipts'::regclass
      AND conname = 'journey_assertion_receipts_impact_contract_check'
  ) THEN
    ALTER TABLE journey_assertion_receipts
      ADD CONSTRAINT journey_assertion_receipts_impact_contract_check
      CHECK (
        (impact_contract_id IS NULL AND impact_contract_hash IS NULL
          AND harness_attempt_id IS NULL)
        OR (
          impact_contract_id IS NOT NULL
          AND impact_contract_hash ~ '^[0-9a-f]{64}$'
          AND harness_attempt_id IS NOT NULL
        )
      );
  END IF;
END $$;

UPDATE initiative_runs
SET impact_contract_policy_reason = COALESCE(
  impact_contract_policy_reason,
  'run predates managed Impact Contract rollout'
)
WHERE impact_contract_policy = 'legacy_exempt';

CREATE OR REPLACE FUNCTION prevent_impact_contract_policy_mutation()
RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW.impact_contract_policy,
    NEW.impact_contract_policy_reason,
    NEW.impact_contract_policy_decision_id
  ) IS DISTINCT FROM ROW(
    OLD.impact_contract_policy,
    OLD.impact_contract_policy_reason,
    OLD.impact_contract_policy_decision_id
  ) THEN
    RAISE EXCEPTION 'initiative run Impact Contract policy is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_impact_contract_policy_mutation ON initiative_runs;
CREATE TRIGGER trg_prevent_impact_contract_policy_mutation
  BEFORE UPDATE OF impact_contract_policy, impact_contract_policy_reason,
    impact_contract_policy_decision_id ON initiative_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_impact_contract_policy_mutation();

CREATE INDEX IF NOT EXISTS idx_harness_gaps_source_task
  ON harness_gaps (source_task_id);
CREATE INDEX IF NOT EXISTS idx_harness_gaps_status
  ON harness_gaps (status);
CREATE INDEX IF NOT EXISTS idx_harness_gaps_repair_task
  ON harness_gaps (repair_task_id) WHERE repair_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gap_events_gap_id
  ON gap_events (gap_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_gap
  ON task_dependencies (gap_id) WHERE gap_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_harness_gap_dependencies_source_status
  ON harness_gap_dependencies (source_task_id, status);
CREATE INDEX IF NOT EXISTS idx_harness_gap_dependencies_repair
  ON harness_gap_dependencies (repair_task_id);

CREATE OR REPLACE FUNCTION prevent_unresolved_harness_gap_unblock()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('queued', 'in_progress', 'completed')
     AND EXISTS (
       SELECT 1
       FROM harness_gaps
       WHERE source_task_id = NEW.id
         AND status <> 'resolved'
     ) THEN
    RAISE EXCEPTION 'task % has unresolved harness gaps', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_unresolved_harness_gap_unblock ON tasks;
CREATE TRIGGER trg_prevent_unresolved_harness_gap_unblock
  BEFORE UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION prevent_unresolved_harness_gap_unblock();

CREATE OR REPLACE FUNCTION prevent_harness_gap_identity_escape()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'resolved' THEN
      RAISE EXCEPTION 'unresolved harness gap cannot be deleted'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF ROW(NEW.source_task_id, NEW.impact_node_id, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.source_task_id, OLD.impact_node_id, OLD.created_at) THEN
    RAISE EXCEPTION 'harness gap authority identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.current_revision IS DISTINCT FROM OLD.current_revision
     AND OLD.status NOT IN ('fixing', 'verifying') THEN
    RAISE EXCEPTION 'harness gap revision can only advance during repair verification'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_harness_gap_identity_escape ON harness_gaps;
CREATE TRIGGER trg_prevent_harness_gap_identity_escape
  BEFORE UPDATE OR DELETE ON harness_gaps
  FOR EACH ROW EXECUTE FUNCTION prevent_harness_gap_identity_escape();

CREATE OR REPLACE FUNCTION enforce_harness_gap_transition()
RETURNS trigger AS $$
DECLARE
  repair_status TEXT;
  repair_completed_at TIMESTAMPTZ;
  verification_started_at TIMESTAMPTZ;
  assertion_receipt_id UUID;
  active_contract_id UUID;
  active_contract_hash TEXT;
  active_contract_repo TEXT;
  contract_assertion JSONB;
  contract_binding JSONB;
  binding_receipt RECORD;
  submitted_run_id TEXT;
  submitted_receipt_seen BOOLEAN := FALSE;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'open' AND NEW.status IN ('assigned', 'triage'))
    OR (OLD.status = 'triage' AND NEW.status = 'assigned')
    OR (OLD.status = 'assigned' AND NEW.status IN ('fixing', 'open'))
    OR (OLD.status = 'fixing' AND NEW.status = 'verifying')
    OR (OLD.status = 'verifying' AND NEW.status IN ('resolved', 'reopened'))
    OR (OLD.status = 'reopened' AND NEW.status = 'assigned')
  ) THEN
    RAISE EXCEPTION 'invalid harness gap transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'resolved' THEN
    BEGIN
      assertion_receipt_id := (NEW.resolution_evidence->>'receipt_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'resolved gap requires a valid receipt_id'
        USING ERRCODE = 'check_violation';
    END;

    IF NEW.resolution_evidence->>'revision' IS DISTINCT FROM NEW.current_revision THEN
      RAISE EXCEPTION 'resolved gap receipt revision mismatch'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT status, completed_at
      INTO repair_status, repair_completed_at
      FROM tasks
     WHERE id = NEW.repair_task_id;
    IF repair_status IS DISTINCT FROM 'completed' OR repair_completed_at IS NULL THEN
      RAISE EXCEPTION 'resolved gap requires completed repair task evidence'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT MAX(created_at)
      INTO verification_started_at
      FROM gap_events
     WHERE gap_id = NEW.id
       AND event_type = 'verification_started';
    IF verification_started_at IS NULL THEN
      RAISE EXCEPTION 'resolved gap requires verification_started event'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT contract.id, contract.contract_hash, contract.repo, assertion.value
      INTO active_contract_id, active_contract_hash, active_contract_repo, contract_assertion
      FROM harness_impact_contracts AS contract
      CROSS JOIN LATERAL jsonb_array_elements(
        contract.contract_body->'required_assertions'
      ) AS assertion(value)
     WHERE contract.task_id = NEW.source_task_id
       AND contract.status = 'active'
       AND assertion.value->>'assertion_id' = NEW.resolution_evidence->>'assertion_id'
       AND assertion.value->'covers_capability_ids' ? NEW.impact_node_id
     ORDER BY contract.version DESC
     LIMIT 1;
    IF contract_assertion IS NULL THEN
      RAISE EXCEPTION 'resolved gap assertion is not in active contract'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT r.run_id
      INTO submitted_run_id
      FROM journey_assertion_receipts AS r
     WHERE r.id = assertion_receipt_id
       AND r.assertion_ref_snapshot = contract_assertion->>'assertion_id'
       AND r.source_repo = active_contract_repo
       AND r.source_sha = NEW.current_revision
       AND r.impact_contract_id = active_contract_id
       AND r.impact_contract_hash = active_contract_hash;
    IF submitted_run_id IS NULL THEN
      RAISE EXCEPTION 'resolved gap submitted receipt is not bound to active contract'
        USING ERRCODE = 'check_violation';
    END IF;

    FOR contract_binding IN
      SELECT value
        FROM jsonb_array_elements(
          COALESCE(
            contract_assertion->'source_bindings',
            jsonb_build_array(jsonb_build_object(
              'journey_step_link_id', contract_assertion->>'journey_step_link_id',
              'assertion_revision', (contract_assertion->>'assertion_revision')::BIGINT,
              'assertion_digest', contract_assertion->>'assertion_digest'
            ))
          )
        )
    LOOP
      SELECT r.*, link.assertion_ref AS current_assertion_ref,
             link.assertion_revision AS current_assertion_revision
        INTO binding_receipt
        FROM journey_assertion_receipts AS r
        JOIN journey_step_links AS link ON link.id = r.journey_step_link_id
        JOIN initiative_runs AS verification_run
          ON verification_run.id::TEXT = r.run_id
         AND verification_run.current_task_id = NEW.repair_task_id
        JOIN harness_attempts AS attempt
          ON attempt.id = r.harness_attempt_id
         AND attempt.run_id::TEXT = r.run_id
         AND attempt.role = 'evaluator'
         AND attempt.status = 'completed'
         AND attempt.result->'decision'->>'outcome' IN ('PASS', 'FIXED')
       WHERE r.run_id = submitted_run_id
         AND r.journey_step_link_id::TEXT = contract_binding->>'journey_step_link_id'
         AND r.assertion_revision = (contract_binding->>'assertion_revision')::BIGINT
         AND r.assertion_ref_snapshot = contract_assertion->>'assertion_id'
         AND r.assertion_digest = contract_binding->>'assertion_digest'
         AND r.source_repo = active_contract_repo
         AND r.source_sha = NEW.current_revision
         AND r.impact_contract_id = active_contract_id
         AND r.impact_contract_hash = active_contract_hash
       ORDER BY r.completed_at DESC
       LIMIT 1;

      IF binding_receipt.id IS NULL
         OR binding_receipt.verdict <> 'PASS'
         OR binding_receipt.exit_code <> 0
         OR binding_receipt.synthetic
         OR binding_receipt.executor_kind <> 'brain_assertion_runner'
         OR binding_receipt.machine_id IS NULL
         OR btrim(binding_receipt.machine_id) = ''
         OR binding_receipt.current_assertion_revision IS DISTINCT FROM binding_receipt.assertion_revision
         OR binding_receipt.current_assertion_ref IS DISTINCT FROM binding_receipt.assertion_ref_snapshot
         OR binding_receipt.command_argv IS DISTINCT FROM
              harness_assertion_command_argv(contract_assertion->>'command')
         OR binding_receipt.completed_at < verification_started_at
         OR binding_receipt.output_digest !~ '^[0-9a-f]{64}$'
         OR binding_receipt.scenario_count <= 0
         OR binding_receipt.scenario_evidence IS NULL THEN
        RAISE EXCEPTION 'resolved gap is missing a trusted source binding receipt'
          USING ERRCODE = 'check_violation';
      END IF;
      IF binding_receipt.id = assertion_receipt_id THEN
        submitted_receipt_seen := TRUE;
      END IF;
    END LOOP;

    IF NOT submitted_receipt_seen THEN
      RAISE EXCEPTION 'resolved gap submitted receipt does not identify a required source binding'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_harness_gap_transition ON harness_gaps;
CREATE TRIGGER trg_enforce_harness_gap_transition
  BEFORE UPDATE OF status ON harness_gaps
  FOR EACH ROW EXECUTE FUNCTION enforce_harness_gap_transition();

COMMENT ON TABLE harness_gaps IS
  'Gap 生命周期台账；记录 CONTRACT_IMPACT_DRIFT 发现、修复与验真状态。';
COMMENT ON TABLE gap_events IS
  'Gap 状态事件链；以 idempotency_key 保证同一事件只写一次。';
COMMENT ON TABLE harness_gap_dependencies IS
  '逐 Gap 的硬依赖权威关联；task_dependencies 仅保留任务对汇总边。';

INSERT INTO schema_version (version, description)
VALUES (409, 'harness_gap_ledger')
ON CONFLICT DO NOTHING;
