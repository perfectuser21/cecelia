-- Rollback 535：撤掉 coding-workflow-runner 执行体类型。
-- 先把该 kind 的任务回落为 headed-session（535 之前 runner 认领的缺省值），再从约束里摘掉 535 追加的那一项，
-- 其余既有 kind 原样保留；约束里找不到该项时报错而不是静默重建。
BEGIN;
UPDATE tasks SET executor_kind = 'headed-session' WHERE executor_kind = 'coding-workflow-runner';
DO $$ DECLARE definition TEXT; restored TEXT;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
  WHERE conrelid='tasks'::regclass AND conname='tasks_executor_kind_check';
 IF definition IS NULL THEN RAISE EXCEPTION 'missing executor contract'; END IF;
 restored := replace(definition, ' OR (executor_kind = ''coding-workflow-runner''::text)', '');
 IF restored = definition THEN RAISE EXCEPTION 'coding-workflow-runner not in tasks_executor_kind_check'; END IF;
 ALTER TABLE tasks DROP CONSTRAINT tasks_executor_kind_check;
 EXECUTE 'ALTER TABLE tasks ADD CONSTRAINT tasks_executor_kind_check ' || restored;
END $$;
COMMIT;
