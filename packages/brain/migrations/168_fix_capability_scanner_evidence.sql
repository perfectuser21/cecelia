-- Migration 168: 修正 capability-scanner 的证据检测数据
--
-- 问题：notion-integration 的 key_tables 为空，导致 Scanner 将其误判为孤岛。
-- 实际上 notion_sync_log 表有记录（已有同步活动），属于 active 能力。
--
-- postgresql-database-service 已在代码层（BRAIN_ALWAYS_ACTIVE）修正，无需迁移。

UPDATE capabilities
SET key_tables = ARRAY['notion_sync_log']
WHERE id = 'notion-integration'
  AND (key_tables IS NULL OR key_tables = '{}');
