-- Freeze GAN-approved contract tests at the exact reviewer-approved commit.

BEGIN;

ALTER TABLE initiative_contracts
  ADD COLUMN IF NOT EXISTS approved_sha TEXT,
  ADD COLUMN IF NOT EXISTS frozen_artifacts JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE initiative_contracts
  DROP CONSTRAINT IF EXISTS initiative_contracts_approved_sha_check,
  ADD CONSTRAINT initiative_contracts_approved_sha_check
    CHECK (approved_sha IS NULL OR approved_sha ~ '^[a-f0-9]{40}$'),
  DROP CONSTRAINT IF EXISTS initiative_contracts_frozen_artifacts_check,
  ADD CONSTRAINT initiative_contracts_frozen_artifacts_check
    CHECK (jsonb_typeof(frozen_artifacts) = 'array');

-- Existing approved runs already carry the immutable reviewer SHA in the
-- append-only decision log. Backfill that identity; Brain fills exact blobs
-- from this SHA once, before the next Generator/Evaluator dispatch.
WITH ranked AS (
  SELECT run.contract_id,
         log.detail->>'contract_sha' AS approved_sha,
         ROW_NUMBER() OVER (
           PARTITION BY run.contract_id
           ORDER BY log.hop DESC
         ) AS rank
    FROM initiative_runs AS run
    JOIN initiative_contracts AS contract ON contract.id = run.contract_id
    JOIN orchestrator_decision_log AS log ON log.run_id = run.id
   WHERE log.action = 'verdict:reviewer'
     AND log.detail->>'verdict' = 'APPROVED'
     AND log.detail->>'contract_sha' ~ '^[a-f0-9]{40}$'
     AND CASE
       WHEN log.detail->>'rn' ~ '^[0-9]+$' THEN (log.detail->>'rn')::integer
       ELSE NULL
     END = contract.version
)
UPDATE initiative_contracts AS contract
   SET approved_sha = ranked.approved_sha
  FROM ranked
 WHERE ranked.contract_id = contract.id
   AND ranked.rank = 1
   AND contract.approved_sha IS NULL;

CREATE OR REPLACE FUNCTION prevent_frozen_contract_artifact_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.approved_sha IS NOT NULL
     AND NEW.approved_sha IS DISTINCT FROM OLD.approved_sha THEN
    RAISE EXCEPTION 'approved contract SHA is immutable';
  END IF;
  IF jsonb_array_length(OLD.frozen_artifacts) > 0
     AND NEW.frozen_artifacts IS DISTINCT FROM OLD.frozen_artifacts THEN
    RAISE EXCEPTION 'approved contract artifacts are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_frozen_contract_artifact_mutation
  ON initiative_contracts;
CREATE TRIGGER trg_prevent_frozen_contract_artifact_mutation
BEFORE UPDATE OF approved_sha, frozen_artifacts ON initiative_contracts
FOR EACH ROW EXECUTE FUNCTION prevent_frozen_contract_artifact_mutation();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('411', 'Freeze approved contract test artifacts at exact SHA', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
