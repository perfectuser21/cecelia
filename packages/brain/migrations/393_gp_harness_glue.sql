-- Migration 393: GP 胶水参数化（债2，task d2567378）
-- 现状 GP_HARNESS_BASE_REPO / GP_HARNESS_TARGET_ENVIRONMENT 是 golden-path-contract-task.js 里
-- 不可覆盖的常量，任何跨 repo 或非 local_api 的 Golden Path 都转不出 harness 任务。
-- 两列都可空：NULL 是「沿用现常量」的载体，存量 GP 一行都不用回填，行为零变化。
-- 回滚脚本在 migrations/rollback/393_gp_harness_glue.down.sql（不放本目录：
-- migrate.js 按文件名排序会让 *.down.sql 抢在 *.sql 之前执行）。

ALTER TABLE golden_paths
  ADD COLUMN IF NOT EXISTS base_repo TEXT;

ALTER TABLE golden_paths
  ADD COLUMN IF NOT EXISTS target_environment TEXT;

-- 枚举与 golden-path-contract-task.js 的 GP_HARNESS_TARGET_ENVIRONMENTS 必须逐字一致
-- （migration-393-gp-harness-glue.test.js 有一条守卫盯着这件事）。
-- 不建 ENUM 类型：新增环境时 ALTER TYPE 要单独一支 migration，而这份清单跟着 harness
-- 能力走，改动频率高于表结构。
ALTER TABLE golden_paths DROP CONSTRAINT IF EXISTS golden_paths_target_environment_check;
ALTER TABLE golden_paths ADD CONSTRAINT golden_paths_target_environment_check
  CHECK (
    target_environment IS NULL
    OR target_environment IN (
      'local_api',
      'mac_web',
      'windows_cloud',
      'windows_wechat',
      'linux_server',
      'playground',
      'android_realmachine'
    )
  );

INSERT INTO schema_version (version, description, applied_at)
VALUES ('393', 'gp harness glue: golden_paths.base_repo + target_environment (nullable, fall back to GP_HARNESS_* constants)', NOW())
ON CONFLICT (version) DO NOTHING;
