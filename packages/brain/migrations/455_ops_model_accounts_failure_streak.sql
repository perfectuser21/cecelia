-- 455: ops_model_accounts 加连续失败计数（刀 0 止血，任务 424d9dd2）
--
-- 为什么需要这一列（主理人 0920 拍板）：一次查不到可能只是网络抖动，
-- 单次失败就下结论既会误报账号故障，也会把上一轮真实读数擦白。
-- 规则：连续 3 轮（3 × 5min = 15min）失败才落确定性 status 并告警一次；
-- 在那之前保持上一轮的 status 与 pct 不动。
--
-- 计数在 upsert 的 SQL 里自增/归零（`consecutive_failures + 1` / `= 0`），
-- 不做「SELECT 判态再 UPDATE」——铁律 761f242b。
ALTER TABLE ops_model_accounts
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN ops_model_accounts.consecutive_failures IS
  '连续采集失败轮数；成功归零。< 3 时视为抖动：保持上轮 status/pct 不动、不告警。';
