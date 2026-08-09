-- Rollback for migration 396（手动执行：psql -f，不被 migrate.js 自动发现）
-- 完全可逆：gear 是新增可空列，没有回填、没有换绑、没有存量行依赖它取值。
-- 唯一的数据代价是「已经标了 hotfix/segmented 的 run 会退回沿用 default 语义」——
-- 这正是 396 之前 kernel 的行为（不读 gear），不是丢失业务事实。

ALTER TABLE initiative_runs DROP COLUMN IF EXISTS gear;

DELETE FROM schema_version WHERE version = '396';
