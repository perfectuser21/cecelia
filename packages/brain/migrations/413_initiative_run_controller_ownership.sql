-- Migration 413: initiative_runs Session Controller 所有权列（Harness 入口统一 sprint 08131104）
--
-- 背景（issue 962d399c 实证无主 Kernel Run）：harness-skill-relay 对 kernel-v1 直接
-- _spawnKernelRuntime，Kernel 是 detached 无主进程，fatal 后 Pipeline ownership 消失。
-- 本列建立「任何活跃 Kernel Run 前必先有有效 Controller ownership」不变量的持久化载体：
--   - controller_session_id：取得 ownership 的 Session Controller 会话标识（NULL = 无主）。
--   - controller_lease_expires_at：ownership 租约到期时刻；过期且无存活 controller = 无主。
--
-- 可空 + 幂等 ADD COLUMN IF NOT EXISTS：存量 run 一行都不回填，读回 NULL 由无主判定
-- （controller_session_id IS NULL OR controller_lease_expires_at < NOW()）在恢复流程接管，
-- 迁移前老数据一律 fail-closed 进恢复，不静默放行（决策：无主 run 不得静默 done）。
-- 不建 CHECK/ENUM：controller_session_id 是运行时动态会话标识（late-bound，非固定枚举）。
-- 回滚脚本在 migrations/rollback/413_initiative_run_controller_ownership.down.sql
-- （不放本目录：migrate.js 按文件名排序会让 *.down.sql 抢在 *.sql 之前执行）。

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS controller_session_id TEXT;

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS controller_lease_expires_at TIMESTAMPTZ;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('413', 'initiative_runs Session Controller ownership (controller_session_id + controller_lease_expires_at)', NOW())
ON CONFLICT (version) DO NOTHING;
