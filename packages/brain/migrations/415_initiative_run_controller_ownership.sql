-- Migration 415: initiative_runs Session Controller 所有权列（Harness 入口统一 sprint 08131104）
--
-- 413/414 是 production authority anchors；Controller ownership 保持 main 已发布的 415。
-- 本列建立「任何活跃 Kernel Run 前必先有有效 Controller ownership」不变量：
--   - controller_session_id：取得 ownership 的 Session Controller 会话标识（NULL = 无主）。
--   - controller_lease_expires_at：ownership 租约到期时刻；过期且无存活 controller = 无主。
--
-- 可空且幂等；存量 run 不回填，运行时按无主状态 fail-closed 进入恢复流程。

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS controller_session_id TEXT;

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS controller_lease_expires_at TIMESTAMPTZ;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('415', 'initiative_runs Session Controller ownership (controller_session_id + controller_lease_expires_at)', NOW())
ON CONFLICT (version) DO NOTHING;
