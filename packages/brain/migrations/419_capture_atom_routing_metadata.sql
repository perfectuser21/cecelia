ALTER TABLE capture_atoms
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='capture_atoms'::regclass
       AND conname='capture_atoms_metadata_object_check'
  ) THEN
    ALTER TABLE capture_atoms
      ADD CONSTRAINT capture_atoms_metadata_object_check
      CHECK (jsonb_typeof(metadata) = 'object');
  END IF;
END
$$;

INSERT INTO schema_version (version, description)
VALUES (419, 'capture atom coding routing metadata')
ON CONFLICT DO NOTHING;
