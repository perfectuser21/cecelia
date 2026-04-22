-- 清理 pre_flight_failed metadata 标记，让 alertOnPreFlightFail 的 24h COUNT 降到 0。
-- 只移除 metadata 的 pre_flight_failed / failed_at 两个 key，保留 task 原 status/title/description
-- （审计痕迹保留，title/description 仍可用于人工排查）。
--
-- 幂等：已经没有这两个 key 的 task 不受影响（WHERE 过滤）。
--
-- 根因（由前置 PR 根治）：POST /api/brain/tasks 的 prd 字段 fallback 漏写，
-- 手工/Agent 注册 task 传 prd 被 destructure 丢弃 → description=null →
-- pre-flight 拒 → 24h 累积 ≥ 3 → P0 pre_flight_burst 飞书轰炸。
--
-- 本 migration 清理存量 ~151 条（实测：24h 内 21 条触发当前 P0 burst）。

UPDATE tasks
SET metadata = metadata - 'pre_flight_failed' - 'failed_at'
WHERE metadata->>'pre_flight_failed' = 'true';
