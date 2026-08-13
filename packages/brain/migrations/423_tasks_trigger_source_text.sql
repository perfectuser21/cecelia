-- Routed provenance names are identifiers, not a 20-character presentation field.
-- Existing producers already use values such as daily-backup-scheduler and
-- execution_callback_harness; preserve them exactly instead of truncating.
ALTER TABLE tasks
  ALTER COLUMN trigger_source TYPE text;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('423', 'preserve full routed task trigger provenance', NOW())
ON CONFLICT (version) DO NOTHING;
