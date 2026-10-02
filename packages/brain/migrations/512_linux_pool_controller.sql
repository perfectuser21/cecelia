-- 只扩充私有controller合同；不根据可编辑payload迁移或恢复历史任务。
DO $$ DECLARE definition TEXT;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
  WHERE conrelid='tasks'::regclass AND conname='tasks_executor_kind_check';
 IF definition IS NULL THEN RAISE EXCEPTION 'missing executor contract'; END IF;
 ALTER TABLE tasks DROP CONSTRAINT tasks_executor_kind_check;
 EXECUTE format('ALTER TABLE tasks ADD CONSTRAINT tasks_executor_kind_check CHECK ((%s) OR executor_kind=%L)',
  substring(definition FROM 8 FOR length(definition)-8),'linux-pool-controller');
END $$;
