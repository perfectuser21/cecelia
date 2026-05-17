-- Migration 235: cecelia_events 加 task_id 列
-- 根因：LangGraph harness pipeline 的 executor.js onStep 回调每步 INSERT 带 task_id::uuid，
--       但表 schema（000_base_schema.sql L111-117）只有 id/event_type/source/payload/created_at，
--       缺 task_id 列，INSERT 必然抛错，被外层 catch { /* non-fatal */ } 吞掉，
--       Dashboard 查询 langgraph_step 事件永远为空。
-- 解决：ADD COLUMN task_id UUID（向后兼容，不加 NOT NULL，不加 FK 避免 cascade delete 丢事件）。
--      加部分索引（只索引非空 task_id），避免索引膨胀。

ALTER TABLE cecelia_events
  ADD COLUMN IF NOT EXISTS task_id UUID;

-- 索引：只索引非空 task_id，按 task 查询事件时提速，节省空间
CREATE INDEX IF NOT EXISTS idx_cecelia_events_task_id
  ON cecelia_events(task_id)
  WHERE task_id IS NOT NULL;

-- 回滚（dev 环境不自动跑，手动 psql 执行）：
--   DROP INDEX IF EXISTS idx_cecelia_events_task_id;
--   ALTER TABLE cecelia_events DROP COLUMN IF EXISTS task_id;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('235', 'cecelia_events 加 task_id 列 + 部分索引，解决 langgraph_step 静默失败', NOW())
ON CONFLICT (version) DO NOTHING;
