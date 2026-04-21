-- Phase 2 of BRAIN_MUTED: initialize runtime-toggle memory key.
-- Idempotent: existing value is preserved (manual set / prior deploy).
-- NOTE: working_memory schema uses `value_json` (jsonb) + `updated_at`, no `value`/`created_at` columns.
INSERT INTO working_memory (key, value_json, updated_at)
VALUES (
  'brain_muted',
  '{"enabled": false, "last_toggled_at": null}'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;
