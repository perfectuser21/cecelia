-- 456: ops_model_accounts 补 7d 重置时刻与分层用量（task eb301e5a）
--
-- 为什么补：0920 上产的配额闸判据是 7d>=90 判死，但表里只有一个 reset_at，
-- 且它对应的是 **5h 窗**（parseAnthropicUsage 映射自 five_hour.resets_at）。
-- 于是一个 7d=91%、10 分钟后就滚窗重置的号会被判死——判死依据不完整。
--
-- 老代码 account-usage.js:646-653 本有 RESET_SOON_MINUTES=30 + effectivePct
-- 的豁免口径（快重置的窗当 0% 算，优先把要过期的额度用掉），刀1 设计时
-- 因为表里没有这一列而划到了范围外。
--
-- 0921 直查 Anthropic 接口证明：响应本就带 seven_day.resets_at 以及
-- seven_day_sonnet / seven_day_opus 等分层用量，是采集器只挑了 five_hour
-- 那一个存下来。所以不是拿不到，是没接。
--
-- 分层两列一并补上：selectBestAccount 的 tier 判据（sonnet/opus 分档）此前
-- 只能吃 account_usage_cache（生产无凭据，数据冻在 09-09），有了这两列之后
-- 才具备迁移到同一份真账本的前提。本 migration 只加列，不改任何判据。
ALTER TABLE ops_model_accounts
  ADD COLUMN IF NOT EXISTS seven_day_reset_at   TIMESTAMPTZ,  -- 7d 滚动窗重置时刻；查不到=NULL（NULL 不豁免）
  ADD COLUMN IF NOT EXISTS seven_day_sonnet_pct INTEGER,      -- 0–100；查不到=NULL（诚实留空，禁编造 0）
  ADD COLUMN IF NOT EXISTS seven_day_opus_pct   INTEGER;

COMMENT ON COLUMN ops_model_accounts.seven_day_reset_at IS
  '7d 滚动窗重置时刻。与 reset_at（5h 窗）分开存，判据据此做 soon-reset 豁免；NULL=不豁免';
