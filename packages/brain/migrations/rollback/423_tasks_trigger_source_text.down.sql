DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tasks WHERE length(trigger_source) > 20) THEN
    RAISE EXCEPTION 'cannot narrow tasks.trigger_source while long provenance values exist';
  END IF;
END $$;

ALTER TABLE tasks
  ALTER COLUMN trigger_source TYPE varchar(20);

DELETE FROM schema_version WHERE version = '423';
