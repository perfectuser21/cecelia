-- Exact-commit-blob authority for remote Planner recovery.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS planner_recovery_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE RESTRICT,
  source_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  planner_attempt_id UUID NOT NULL UNIQUE REFERENCES harness_attempts(id) ON DELETE RESTRICT,
  attempt_hop INTEGER NOT NULL CHECK (attempt_hop >= 1),
  lease_generation INTEGER NOT NULL CHECK (lease_generation >= 0),
  repo TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  prd_path TEXT NOT NULL,
  resolved_branch TEXT NOT NULL,
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  changed_files JSONB NOT NULL,
  changed_files_digest TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT planner_recovery_receipts_repo_check
    CHECK (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  CONSTRAINT planner_recovery_receipts_sha_check
    CHECK (base_sha ~ '^[a-f0-9]{40}$' AND head_sha ~ '^[a-f0-9]{40}$'),
  CONSTRAINT planner_recovery_receipts_digest_check
    CHECK (
      content_sha256 ~ '^[a-f0-9]{64}$'
      AND changed_files_digest ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT planner_recovery_receipts_path_check
    CHECK (
      prd_path ~ '^sprints/[A-Za-z0-9._/-]+/sprint-prd[.]md$'
      AND prd_path !~ '(^/|\\|//|(^|/)[.][.]?(/|$))'
      AND resolved_branch ~ '^cp-[a-z0-9][a-z0-9._-]{0,126}$'
    ),
  CONSTRAINT planner_recovery_receipts_content_check
    CHECK (
      byte_length BETWEEN 1 AND 524288
      AND byte_length = OCTET_LENGTH(content)
      AND BTRIM(content) <> ''
      AND content_sha256 = ENCODE(DIGEST(CONVERT_TO(content, 'UTF8'), 'sha256'), 'hex')
    ),
  CONSTRAINT planner_recovery_receipts_changed_files_check
    CHECK (
      JSONB_TYPEOF(changed_files) = 'array'
      AND JSONB_ARRAY_LENGTH(changed_files) = 1
      AND changed_files->>0 = prd_path
      AND changed_files_digest = ENCODE(
        DIGEST(CONVERT_TO(changed_files::text, 'UTF8'), 'sha256'),
        'hex'
      )
    ),
  CONSTRAINT planner_recovery_receipts_method_check
    CHECK (verification_method = 'remote_exact_commit_blob')
);

CREATE OR REPLACE FUNCTION enforce_planner_recovery_receipt_authority()
RETURNS TRIGGER AS $$
DECLARE
  authority RECORD;
  receipt_summary JSONB;
BEGIN
  -- recordCallbackTerminal already owns run -> Attempt locks. This validation
  -- only reads those rows and never explicitly locks tasks, preserving the
  -- established run-first lock order.
  SELECT run.phase AS run_phase,
         run.current_task_id,
         attempt.run_id,
         attempt.hop,
         attempt.role,
         attempt.status,
         attempt.lease_generation,
         attempt.execution_transport,
         attempt.requested_machine_id,
         attempt.actual_machine_id,
         attempt.machine_attestation_status,
         attempt.task_bundle,
         attempt.result
    INTO authority
    FROM initiative_runs AS run
    JOIN harness_attempts AS attempt
      ON attempt.id = NEW.planner_attempt_id
     AND attempt.run_id = run.id
   WHERE run.id = NEW.predecessor_run_id;

  IF NOT FOUND
     OR authority.current_task_id IS DISTINCT FROM NEW.source_task_id
     OR authority.run_id IS DISTINCT FROM NEW.predecessor_run_id
     OR authority.hop IS DISTINCT FROM NEW.attempt_hop
     OR authority.role IS DISTINCT FROM 'planner'
     OR authority.status NOT IN ('completed', 'completed_with_concerns')
     OR authority.result->>'status' IS DISTINCT FROM authority.status
     OR authority.result->>'status' NOT IN ('completed', 'completed_with_concerns')
     OR authority.lease_generation IS DISTINCT FROM NEW.lease_generation
     OR authority.run_phase IN ('done', 'failed')
     OR authority.execution_transport NOT IN ('fleet-worker', 'remote-bridge')
     OR authority.machine_attestation_status IS DISTINCT FROM 'verified'
     OR authority.actual_machine_id IS NULL
     OR authority.actual_machine_id IS DISTINCT FROM authority.requested_machine_id THEN
    RAISE EXCEPTION 'planner_recovery_receipt_authority_invalid'
      USING ERRCODE = '23514';
  END IF;

  receipt_summary := authority.result
    -> 'server_verification'
    -> 'planner_recovery_receipt';
  IF authority.task_bundle->'inputs'->>'task_id' IS DISTINCT FROM NEW.source_task_id::text
     OR authority.task_bundle->'inputs'->'workspace_spec'->>'repo' IS DISTINCT FROM NEW.repo
     OR authority.task_bundle->'inputs'->'workspace_spec'->>'base_sha' IS DISTINCT FROM NEW.base_sha
     OR authority.task_bundle->'inputs'->>'planner_branch' IS DISTINCT FROM NEW.resolved_branch
     OR CONCAT(authority.task_bundle->'inputs'->>'sprint_dir', '/sprint-prd.md')
          IS DISTINCT FROM NEW.prd_path
     OR receipt_summary->>'head_sha' IS DISTINCT FROM NEW.head_sha
     OR receipt_summary->>'content_sha256' IS DISTINCT FROM NEW.content_sha256
     OR receipt_summary->>'changed_files_digest' IS DISTINCT FROM NEW.changed_files_digest
     OR receipt_summary->>'verification_method' IS DISTINCT FROM NEW.verification_method
     OR receipt_summary->>'byte_length' IS DISTINCT FROM NEW.byte_length::text THEN
    RAISE EXCEPTION 'planner_recovery_receipt_evidence_mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS planner_recovery_receipts_authority
  ON planner_recovery_receipts;
CREATE TRIGGER planner_recovery_receipts_authority
BEFORE INSERT ON planner_recovery_receipts
FOR EACH ROW EXECUTE FUNCTION enforce_planner_recovery_receipt_authority();

CREATE OR REPLACE FUNCTION reject_planner_recovery_receipt_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'planner_recovery_receipts_append_only'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS planner_recovery_receipts_immutable
  ON planner_recovery_receipts;
CREATE TRIGGER planner_recovery_receipts_immutable
BEFORE UPDATE OR DELETE ON planner_recovery_receipts
FOR EACH ROW EXECUTE FUNCTION reject_planner_recovery_receipt_mutation();

INSERT INTO schema_version(version, description, applied_at)
VALUES ('428', 'Immutable exact-commit Planner recovery receipts', NOW())
ON CONFLICT (version) DO NOTHING;
