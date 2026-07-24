-- Migration 360: durable Codex Slot control-plane state.
-- Machine identity and capacity continue to come from system_registry,
-- fleet-resource-cache, and slot-allocator.

CREATE TABLE IF NOT EXISTS codex_slot_actor_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  identity_kind TEXT NOT NULL
    CHECK (identity_kind IN ('uid', 'ssh_key')),
  identity_ref TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_codex_slot_actor_identity
    UNIQUE (identity_kind, identity_ref)
);

CREATE INDEX IF NOT EXISTS idx_codex_slot_actor_identities_actor
  ON codex_slot_actor_identities (tenant_id, actor_id)
  WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS codex_slot_rollout (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  rollout_key TEXT NOT NULL DEFAULT 'codex-slot',
  state TEXT NOT NULL DEFAULT 'frozen'
    CHECK (state IN ('frozen', 'open')),
  inventory_complete BOOLEAN NOT NULL DEFAULT FALSE,
  cutover_steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  opened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_codex_slot_rollout_tenant
    UNIQUE (tenant_id, rollout_key),
  CHECK (state <> 'open' OR inventory_complete = TRUE)
);

CREATE TABLE IF NOT EXISTS codex_slot_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  identity_id UUID NOT NULL
    REFERENCES codex_slot_actor_identities(id),
  request_id UUID NOT NULL,
  account_ref TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'quarantined', 'blocked', 'released')),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_codex_slot_lease_request UNIQUE (tenant_id, request_id),
  CHECK (
    (state = 'released' AND released_at IS NOT NULL)
    OR (state <> 'released' AND released_at IS NULL)
  )
);

-- A company account is globally single-slot while its lease blocks reuse.
-- tenant_id is intentionally absent from this key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_codex_slot_leases_blocking_account
  ON codex_slot_leases (account_ref)
  WHERE state IN ('active', 'quarantined', 'blocked');

CREATE INDEX IF NOT EXISTS idx_codex_slot_leases_tenant_state
  ON codex_slot_leases (tenant_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS codex_slot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID NOT NULL UNIQUE
    REFERENCES codex_slot_leases(id),
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_id UUID NOT NULL,
  agent_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  receipt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'stopping', 'stopped', 'quarantined', 'blocked')),
  cleanup JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_codex_slot_session_request UNIQUE (tenant_id, request_id),
  CONSTRAINT uq_codex_slot_session_handle UNIQUE (tenant_id, handle)
);

CREATE INDEX IF NOT EXISTS idx_codex_slot_sessions_tenant_status
  ON codex_slot_sessions (tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS codex_slot_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_id UUID NOT NULL,
  lease_id UUID REFERENCES codex_slot_leases(id),
  session_id UUID REFERENCES codex_slot_sessions(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_codex_slot_audit_request
  ON codex_slot_audit_events (tenant_id, request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_codex_slot_audit_session
  ON codex_slot_audit_events (tenant_id, session_id, created_at)
  WHERE session_id IS NOT NULL;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('360', 'Durable Codex Slot identity, rollout, lease, session, and audit state', NOW())
ON CONFLICT (version) DO NOTHING;
