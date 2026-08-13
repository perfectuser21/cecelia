BEGIN;

DROP TRIGGER IF EXISTS work_routing_task_projection_immutable ON tasks;
DROP FUNCTION IF EXISTS reject_work_routing_task_projection_mutation();
DELETE FROM schema_version WHERE version = '420';

COMMIT;
