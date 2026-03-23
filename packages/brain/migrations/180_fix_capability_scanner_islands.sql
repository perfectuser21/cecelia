-- Migration 180: 修正 capability-scanner 孤岛误判的元数据
--
-- 问题：3个能力因 key_tables 缺失或指向不存在的表，被扫描器误判为孤岛。
--
-- credential-management: key_tables 为 null → decisions 表（9886 行）有活跃数据
-- multi-platform-publishing: key_tables 为 null → content_publish_jobs 表存在且有数据
-- ai-driven-trading: key_tables 指向 portfolio/trades/market_data（均不存在）
--   → 改为 trading_config（已存在，有 3 行配置数据）
--
-- 这些修正使扫描器可通过 key_tables 证据正确判定为 active/dormant，
-- 而非 island（从未使用过的孤岛）。

UPDATE capabilities
SET key_tables = ARRAY['decisions']
WHERE id = 'credential-management'
  AND (key_tables IS NULL OR key_tables = '{}');

UPDATE capabilities
SET key_tables = ARRAY['content_publish_jobs']
WHERE id = 'multi-platform-publishing'
  AND (key_tables IS NULL OR key_tables = '{}');

UPDATE capabilities
SET key_tables = ARRAY['trading_config']
WHERE id = 'ai-driven-trading';
