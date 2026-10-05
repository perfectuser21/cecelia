-- Rollback 527：删视图，旧唯一约束/索引恢复；非空约束只在没有空值时恢复（读者迁完后新写入的 Activity 可能没有这两列，那时回滚前要先补值）
BEGIN;

DROP VIEW IF EXISTS activity_placement;
DROP INDEX IF EXISTS uq_activities_capability_activity;

CREATE UNIQUE INDEX IF NOT EXISTS uq_journey_steps_activity ON activities (journey_id, activity_key) WHERE activity_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS activities_journey_id_step_number_key ON activities (journey_id, step_number);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM activities WHERE journey_id IS NULL) THEN
    ALTER TABLE activities ALTER COLUMN journey_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM activities WHERE step_number IS NULL) THEN
    ALTER TABLE activities ALTER COLUMN step_number SET NOT NULL;
  END IF;
END $$;

DELETE FROM schema_version WHERE version = '527';

COMMIT;
