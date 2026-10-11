-- 迁移 549（任务 f38e7cc2，决策 23cc0951 / 3c98fb36）：tasks_task_type_check 纳入 workflow_dispatch。
-- Brain 主动把 workflow 派给 work-commander 的一等类型（与 workflow_run 外部镜像分开）。
-- 在现有约束定义上追加一个值（同 504 写法），不重抄全量名单，避免与并行迁移互相覆盖。
BEGIN;
DO $$ DECLARE definition TEXT; BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
   WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_task_type_check';
  IF definition IS NULL THEN RAISE EXCEPTION 'missing tasks_task_type_check'; END IF;
  IF position('''workflow_dispatch''' IN definition) > 0 THEN RETURN; END IF;
  ALTER TABLE tasks DROP CONSTRAINT tasks_task_type_check;
  EXECUTE format('ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK ((%s) OR task_type = %L)',
    substring(definition FROM 8 FOR length(definition) - 8), 'workflow_dispatch');
END $$;

INSERT INTO schema_version (version, description)
VALUES ('549', 'tasks_task_type_check 纳入 workflow_dispatch（Brain 主动派 workflow 给 Commander）')
ON CONFLICT (version) DO NOTHING;

COMMIT;
