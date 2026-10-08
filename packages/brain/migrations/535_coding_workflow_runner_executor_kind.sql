-- coding workflow runner（执行机 LaunchDaemon）认领开关任务时写 executor_kind='coding-workflow-runner'，
-- 让启动同步/探活把它当外部执行体（不打回 queued、不清 claim）。只扩充约束，不迁移历史数据。
DO $$ DECLARE definition TEXT;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
  WHERE conrelid='tasks'::regclass AND conname='tasks_executor_kind_check';
 IF definition IS NULL THEN RAISE EXCEPTION 'missing executor contract'; END IF;
 ALTER TABLE tasks DROP CONSTRAINT tasks_executor_kind_check;
 EXECUTE format('ALTER TABLE tasks ADD CONSTRAINT tasks_executor_kind_check CHECK ((%s) OR executor_kind=%L)',
  substring(definition FROM 8 FOR length(definition)-8),'coding-workflow-runner');
END $$;
