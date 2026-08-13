ALTER TABLE capture_atoms
  DROP CONSTRAINT IF EXISTS capture_atoms_metadata_object_check,
  DROP COLUMN IF EXISTS metadata;
