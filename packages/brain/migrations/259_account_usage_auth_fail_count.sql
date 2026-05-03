-- Migration 259: account_usage_cache 加 auth_fail_count 列
-- 问题：_authFailureCountMap 仅在内存中，Brain 重启后指数退避计数清零，
-- account3 等失效账号每次重启后只被阻断 2h 而非累积到 24h（max），
-- 导致短时间内产生数百次 auth 失败循环。
-- 修复：将退避计数持久化到 DB，重启后正确恢复。

ALTER TABLE account_usage_cache
  ADD COLUMN IF NOT EXISTS auth_fail_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN account_usage_cache.auth_fail_count IS '连续 auth 失败次数，用于指数退避计算（2→4→8→24h），重启后可从 DB 恢复';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('259', 'account_usage_cache: add auth_fail_count for persistent exponential backoff', NOW())
ON CONFLICT DO NOTHING;
