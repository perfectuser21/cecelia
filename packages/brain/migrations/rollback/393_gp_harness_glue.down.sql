-- Rollback for migration 393（手动执行：psql -f，不被 migrate.js 自动发现）
-- 完全可逆：两列都是新增的可空列，没有回填、没有换绑、没有存量行依赖它们取值。
-- 唯一的数据代价是「已经填了 base_repo/target_environment 的 GP 会退回沿用常量」——
-- 这正是 393 之前的行为，不是丢失业务事实。

ALTER TABLE golden_paths DROP CONSTRAINT IF EXISTS golden_paths_target_environment_check;
ALTER TABLE golden_paths DROP COLUMN IF EXISTS target_environment;
ALTER TABLE golden_paths DROP COLUMN IF EXISTS base_repo;

DELETE FROM schema_version WHERE version = '393';
