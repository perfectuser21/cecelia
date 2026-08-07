-- Rollback for migration 392（手动执行：psql -f，不被 migrate.js 自动发现）
-- 可逆性边界：尚未建过任何新格号 run 时完全可逆；建过之后 fail-fast 报错并说明清理路径，
-- 不静默丢数据。恢复全局 UNIQUE (check_key) 在新格号数据存在时物理不可能——
-- 第二轮 run 的 S3-c1 与第一轮的 S3-c1 必然重复，这正是 J5-A 要解决的原问题。

DO $$
DECLARE dup int;
DECLARE newstat int;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT check_key FROM acceptance_checks GROUP BY check_key HAVING count(*) > 1
  ) t;
  IF dup > 0 THEN
    RAISE EXCEPTION '不可回滚：已存在 % 个跨 run 重复的 check_key（新格号数据）。回滚前须先清理这些 run，否则全局 UNIQUE 无法重建', dup;
  END IF;

  -- 与上面的重复格号守卫对称：status 收回 4 值同样会被新状态值的存量行挡住。
  -- 不加这道守卫，回滚会在 ADD CONSTRAINT 处抛裸 23514「is violated by some row」，
  -- 运维拿不到「该清哪些 run」的信息，只能自己去猜。
  SELECT count(*) INTO newstat FROM acceptance_runs
   WHERE status NOT IN ('pending','in_review','passed','failed');
  IF newstat > 0 THEN
    RAISE EXCEPTION '不可回滚：已存在 % 个处于 7 值新状态（human_complete/adjudicated/stale/expired/abandoned）的 run。回滚前须先清理或迁走这些 run，否则 4 值 CHECK 无法重建', newstat;
  END IF;
END $$;

ALTER TABLE acceptance_checks DROP CONSTRAINT IF EXISTS uq_acceptance_checks_run_key;
ALTER TABLE acceptance_checks ADD CONSTRAINT acceptance_checks_check_key_key UNIQUE (check_key);

ALTER TABLE acceptance_runs DROP CONSTRAINT IF EXISTS acceptance_runs_status_check;
ALTER TABLE acceptance_runs ADD CONSTRAINT acceptance_runs_status_check
  CHECK (status IN ('pending','in_review','passed','failed'));

ALTER TABLE acceptance_runs DROP COLUMN IF EXISTS detail;

ALTER TABLE acceptance_checks DROP CONSTRAINT IF EXISTS acceptance_checks_ai_verdict_check;
ALTER TABLE acceptance_checks DROP COLUMN IF EXISTS adjudication;
ALTER TABLE acceptance_checks DROP COLUMN IF EXISTS ai_run_at;
ALTER TABLE acceptance_checks DROP COLUMN IF EXISTS ai_evidence;
ALTER TABLE acceptance_checks DROP COLUMN IF EXISTS ai_verdict;

DELETE FROM schema_version WHERE version = '392';
