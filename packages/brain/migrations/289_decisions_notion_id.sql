-- Migration 289: 为 decisions 和 initiative_contracts 补加 notion_id 列
-- Migration 284（PR #3140）只加了 notion_synced_at，漏掉 notion_id，
-- 导致 notion-push-sync 每次 Notion 页面创建成功后回写 notion_id 报错，
-- 记录永远不标 synced，5 分钟定时任务无限重复推送产生 Notion 重复条目。

ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS notion_id VARCHAR(100) UNIQUE;

ALTER TABLE initiative_contracts
  ADD COLUMN IF NOT EXISTS notion_id VARCHAR(100) UNIQUE;
