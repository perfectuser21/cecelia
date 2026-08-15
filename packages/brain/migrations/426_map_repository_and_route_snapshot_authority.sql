-- A repository has exactly one authoritative Map scope.
-- This removes the routing phantom where a second scope could appear after validation.

CREATE UNIQUE INDEX IF NOT EXISTS uq_map_scope_repositories_repo
  ON map_scope_repositories(repo);

ALTER TABLE work_routing_receipts
  ADD COLUMN IF NOT EXISTS map_scope_validation_version text;

-- Existing append-only receipts remain NULL. NOT VALID preserves those rows,
-- while PostgreSQL enforces the validator generation for every new coding row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'work_routing_receipts'::regclass
       AND conname = 'work_routing_receipts_map_scope_validation_version_check'
  ) THEN
    ALTER TABLE work_routing_receipts
      ADD CONSTRAINT work_routing_receipts_map_scope_validation_version_check
      CHECK (
        work_kind <> 'coding_mutation'
        OR (
          map_scope_validation_version IS NOT NULL
          AND map_scope_validation_version = 'active-business-node-v1'
        )
      ) NOT VALID;
  END IF;
END
$$;

-- Receipt rows are append-only authority. New coding receipts must preserve the
-- canonical change-kind profile and may only keep or strengthen that profile.
-- NOT VALID avoids rewriting or retroactively judging legacy authority rows,
-- while PostgreSQL still enforces the constraint for every new INSERT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'work_routing_receipts'::regclass
       AND conname = 'work_routing_receipts_profile_shape_strength_check'
  ) THEN
    ALTER TABLE work_routing_receipts
      ADD CONSTRAINT work_routing_receipts_profile_shape_strength_check
      CHECK (
        work_kind <> 'coding_mutation'
        OR (
          change_kind IS NOT NULL
          AND default_execution_profile IS NOT NULL
          AND change_kind IN ('new_capability','capability_change','bugfix','parameter_only')
          AND default_execution_profile = CASE change_kind
            WHEN 'new_capability' THEN 'new-capability-v1'
            WHEN 'capability_change' THEN 'capability-change-v1'
            WHEN 'bugfix' THEN 'hotfix-v1'
            WHEN 'parameter_only' THEN 'parameter-only-v1'
          END
          AND (
            execution_profile_override IS NULL
            OR (
              execution_profile_override IN (
                'new-capability-v1','capability-change-v1','hotfix-v1','parameter-only-v1'
              )
              AND (
                execution_profile_override = default_execution_profile
                OR CASE execution_profile_override
                  WHEN 'parameter-only-v1' THEN 0
                  WHEN 'hotfix-v1' THEN 0
                  WHEN 'capability-change-v1' THEN 1
                  WHEN 'new-capability-v1' THEN 2
                END > CASE default_execution_profile
                  WHEN 'parameter-only-v1' THEN 0
                  WHEN 'hotfix-v1' THEN 0
                  WHEN 'capability-change-v1' THEN 1
                  WHEN 'new-capability-v1' THEN 2
                END
              )
            )
          )
        )
      ) NOT VALID;
  END IF;
END
$$;

INSERT INTO schema_version (version, description)
VALUES ('426', 'Unique Map repository scope authority and routed snapshot locking')
ON CONFLICT (version) DO NOTHING;
