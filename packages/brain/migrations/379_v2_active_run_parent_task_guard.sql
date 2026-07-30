-- Migration 379: prevent active v2 runs from outliving a terminal parent task.
--
-- Direct legacy writers bypass createKernelRun(), so the database INSERT
-- trigger must participate in the same initiative -> task lock order. FOR
-- UPDATE intentionally conflicts with concurrent task terminalization; after
-- that transaction commits, this trigger sees the new task status.

CREATE OR REPLACE FUNCTION lock_initiative_run_insert_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_id text;
  parent_task_status text;
BEGIN
  normalized_id := replace(NEW.initiative_id::text, '-', '');
  PERFORM pg_advisory_xact_lock(
    hashtextextended('relay-prefix:' || lower(substr(normalized_id, 1, 8)), 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('relay-initiative:' || NEW.initiative_id::text, 0)
  );

  IF NEW.orchestrator_version = 'v2'
     AND NEW.current_task_id IS NOT NULL
     AND NEW.phase NOT IN ('done', 'failed') THEN
    SELECT status
      INTO parent_task_status
      FROM tasks
     WHERE id = NEW.current_task_id
       FOR UPDATE;

    IF parent_task_status IN ('completed', 'failed', 'cancelled', 'canceled') THEN
      RAISE EXCEPTION
        'active v2 initiative run requires nonterminal parent task: %/%',
        NEW.current_task_id,
        parent_task_status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('379', 'Reject active v2 runs for terminal parent tasks', NOW())
ON CONFLICT (version) DO NOTHING;
