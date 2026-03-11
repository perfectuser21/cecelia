-- Migration 147: brain_config 新增 quota_reset_at 配置项
-- 背景：存储 Anthropic API 配额重置时间，供 Tick Loop 在配额恢复后自动解锁任务。
-- 使用已有 brain_config key-value 表（key PRIMARY KEY, value TEXT NOT NULL）。

-- 插入 quota_reset_at 配置项（初始值为 'not_set'，由应用层更新为 ISO 时间字符串）
INSERT INTO brain_config (key, value, updated_at)
VALUES ('quota_reset_at', 'not_set', NOW())
ON CONFLICT (key) DO NOTHING;

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('147', 'brain_config quota_reset_at 配额重置时间存储', NOW())
ON CONFLICT (version) DO NOTHING;
