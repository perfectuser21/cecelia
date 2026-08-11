-- Migration 406: Explicit scope-to-repository adapter configuration for Universal Map.

CREATE TABLE IF NOT EXISTS map_scope_repositories (
  scope_key TEXT NOT NULL CHECK (length(btrim(scope_key)) > 0),
  repo TEXT NOT NULL CHECK (length(btrim(repo)) > 0),
  adapter_key TEXT NOT NULL CHECK (adapter_key ~ '^[a-z][a-z0-9-]*-v[1-9][0-9]*$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_key, repo)
);

INSERT INTO map_scope_repositories (scope_key, repo, adapter_key)
VALUES ('cecelia', 'cecelia', 'legacy-ledger-v1')
ON CONFLICT (scope_key, repo) DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('406', 'Explicit Universal Map scope repository adapters')
ON CONFLICT (version) DO NOTHING;
