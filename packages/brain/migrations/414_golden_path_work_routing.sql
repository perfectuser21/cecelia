BEGIN;

ALTER TABLE golden_paths
  ADD COLUMN IF NOT EXISTS change_kind TEXT;

ALTER TABLE golden_paths
  ADD COLUMN IF NOT EXISTS map_scope JSONB;

ALTER TABLE golden_paths
  DROP CONSTRAINT IF EXISTS golden_paths_change_kind_check;
ALTER TABLE golden_paths
  ADD CONSTRAINT golden_paths_change_kind_check CHECK (
    change_kind IS NULL
    OR change_kind IN (
      'new_capability',
      'capability_change',
      'bugfix',
      'parameter_only'
    )
  );

ALTER TABLE golden_paths
  DROP CONSTRAINT IF EXISTS golden_paths_map_scope_check;
ALTER TABLE golden_paths
  ADD CONSTRAINT golden_paths_map_scope_check CHECK (
    map_scope IS NULL
    OR (
      jsonb_typeof(map_scope) = 'array'
      AND jsonb_array_length(map_scope) > 0
    )
  );

INSERT INTO schema_version (version, description, applied_at)
VALUES ('414', 'Explicit Golden Path work routing inputs', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
