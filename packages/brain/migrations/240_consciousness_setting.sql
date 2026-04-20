-- Phase 2 of CONSCIOUSNESS_ENABLED: initialize runtime-toggle memory key.
-- Idempotent: existing value is preserved (manual set / prior Phase 2 deploy).
INSERT INTO working_memory (key, value, created_at, updated_at)
VALUES (
  'consciousness_enabled',
  '{"enabled": true, "last_toggled_at": null}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
