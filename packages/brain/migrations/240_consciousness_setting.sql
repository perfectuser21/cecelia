-- Phase 2 of CONSCIOUSNESS_ENABLED: initialize runtime-toggle memory key.
-- Idempotent: existing value is preserved (manual set / prior Phase 2 deploy).
-- NOTE: working_memory schema uses `value_json` (jsonb) + `updated_at`, no `value`/`created_at` columns.
INSERT INTO working_memory (key, value_json, updated_at)
VALUES (
  'consciousness_enabled',
  '{"enabled": true, "last_toggled_at": null}'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;
