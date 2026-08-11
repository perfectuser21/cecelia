-- Migration 402: Universal Map Manifest immutable version store.
-- Business intent enters Map core only as a complete, decision-bound manifest.

CREATE TABLE IF NOT EXISTS map_manifest_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  source_decision_id UUID NOT NULL REFERENCES decisions(id),
  manifest JSONB NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'superseded', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  CONSTRAINT map_manifest_scope_version_unique UNIQUE (scope_key, version),
  CONSTRAINT map_manifest_scope_digest_unique UNIQUE (scope_key, digest),
  CONSTRAINT map_manifest_scope_matches_body
    CHECK (manifest->>'scope_key' = scope_key),
  CONSTRAINT map_manifest_decision_matches_body
    CHECK (manifest->>'source_decision_id' = source_decision_id::text),
  CONSTRAINT map_manifest_schema_v1
    CHECK (manifest->>'schema_version' = '1'),
  CONSTRAINT map_manifest_activation_shape
    CHECK (
      (status IN ('active', 'superseded') AND activated_at IS NOT NULL)
      OR (status IN ('draft', 'rejected') AND activated_at IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_map_manifest_one_active_per_scope
  ON map_manifest_versions(scope_key)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_map_manifest_scope_created
  ON map_manifest_versions(scope_key, created_at DESC);

CREATE OR REPLACE FUNCTION reject_map_manifest_content_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scope_key IS DISTINCT FROM OLD.scope_key
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.source_decision_id IS DISTINCT FROM OLD.source_decision_id
    OR NEW.manifest IS DISTINCT FROM OLD.manifest
    OR NEW.digest IS DISTINCT FROM OLD.digest
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'map manifest versions are immutable; submit a complete new version'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS map_manifest_content_immutable ON map_manifest_versions;
CREATE TRIGGER map_manifest_content_immutable
  BEFORE UPDATE ON map_manifest_versions
  FOR EACH ROW
  EXECUTE FUNCTION reject_map_manifest_content_update();

INSERT INTO schema_version (version, description)
VALUES ('402', 'Universal Map Manifest immutable versions')
ON CONFLICT (version) DO NOTHING;
