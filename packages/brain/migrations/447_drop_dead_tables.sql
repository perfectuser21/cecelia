-- 447: 清理 6 张死表（主理人 2026-09-16 拍板）
--
-- 判据：0 行 + 全仓 0 代码引用（grep packages/brain/src apps，排除 __tests__）。
-- 生产（us-vps）已于 2026-09-16 先行执行同内容 DROP，本 migration 使 CI/测试库
-- 与生产对齐，防 schema 分叉。
--
-- 特意保留的同名近亲（勿混淆）：
--   agents(6行,134处引用)=组织花名册；ops_agents(51行)=运行舱进程台账——两者角色不同非重复
--   task_runs/run_artifacts/golden_path_run_receipts：0 行但有代码引用，是待用新表
--
-- 外键从表 wechat_rpa_sessions/device_result/check_result 当时均为 0 行，仅断约束不动表。

ALTER TABLE IF EXISTS wechat_rpa_sessions DROP CONSTRAINT IF EXISTS wechat_rpa_sessions_agent_id_fkey;
ALTER TABLE IF EXISTS device_result DROP CONSTRAINT IF EXISTS device_result_run_id_fkey;
ALTER TABLE IF EXISTS check_result DROP CONSTRAINT IF EXISTS check_result_run_id_fkey;

DROP TABLE IF EXISTS agent_events;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS agent_ops_agents;
DROP TABLE IF EXISTS acceptance_run;
DROP TABLE IF EXISTS project_agents;
DROP TABLE IF EXISTS capability_runs;
