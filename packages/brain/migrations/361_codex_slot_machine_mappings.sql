-- Migration 361: attach Codex Slot agent/fleet/MMV mappings to the existing
-- machine registry rows. system_registry remains the identity SSOT.

INSERT INTO system_registry (
  type,
  name,
  location,
  description,
  status,
  metadata
)
VALUES
  (
    'machine',
    'mac-mini-m1-xian',
    '100.88.166.55',
    '西安 Mac mini M1，Codex 工作节点',
    'active',
    '{
      "agent_id": "xian-m1",
      "fleet_id": "xian-mac-m1",
      "root_attested": true,
      "mmv_stable_node_id": "us-wisconsin-codex-slot-m1",
      "mmv_allowed_ips": ["38.23.47.81"]
    }'::jsonb
  ),
  (
    'machine',
    'mac-mini-m4-xian',
    '100.86.57.69',
    '西安 Mac mini M4，Codex 主力机',
    'active',
    '{
      "agent_id": "xian-m4",
      "fleet_id": "xian-mac-m4",
      "root_attested": true,
      "mmv_stable_node_id": "us-wisconsin-codex-slot-m4",
      "mmv_allowed_ips": ["38.23.47.81"]
    }'::jsonb
  )
ON CONFLICT (type, name) DO UPDATE
SET metadata = COALESCE(system_registry.metadata, '{}'::jsonb) || EXCLUDED.metadata;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('361', 'Codex Slot machine, fleet, and MMV mappings in system_registry', NOW())
ON CONFLICT (version) DO NOTHING;
