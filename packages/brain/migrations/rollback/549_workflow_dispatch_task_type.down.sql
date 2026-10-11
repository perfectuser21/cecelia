-- 回滚 549：先把 workflow_dispatch 行改成 cancelled 不可行（类型约束仍拦），需先人工处置这些行再执行。
-- 约束回退：在线上用 pg_get_constraintdef 取当前定义去掉 OR task_type = 'workflow_dispatch' 后重建。
BEGIN;
DO $$ DECLARE definition TEXT; BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
   WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_task_type_check';
  IF definition IS NULL OR position('''workflow_dispatch''' IN definition) = 0 THEN RETURN; END IF;
  definition := replace(definition, ' OR ((task_type)::text = ''workflow_dispatch''::text)', '');
  ALTER TABLE tasks DROP CONSTRAINT tasks_task_type_check;
  EXECUTE 'ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check ' || definition;
END $$;
DELETE FROM schema_version WHERE version = '549';
COMMIT;
