-- Migration 270: learnings 表加 task_id 列 + FK + 部分索引 + backfill from metadata
--
-- 根因（Cortex Insight, learning_id=292f5859-ac6b-4e34-b046-f212196fde47）：
--   Learning 无 task_id 物理绑定 → 洞察层（learnings）到行动层（tasks）只有
--   metadata JSONB 这一条软引用，无法外键约束、无法索引查询、无法 cascade。
--   症状：
--     1) decision-executor.js 一直在 INSERT INTO learnings(..., source_task_id, ...)
--        但 learnings 表没有 source_task_id 列 → 这两条 action（create_learning /
--        suggest_task_type）永远静默抛错 → 洞察→行动彻底断链 = 死代码。
--     2) auto-learning.js / cortex.js / executor.js 等只把 task_id 塞进 metadata
--        JSONB，无法 JOIN tasks 反查、无 FK 完整性保证、SQL 统计孤立学习困难。
--
-- 方案（对照 235_cecelia_events_task_id.sql 的成功模式）：
--   ADD COLUMN task_id UUID + FK REFERENCES tasks(id) ON DELETE SET NULL
--   （ON DELETE SET NULL：任务删除时保留 learning，避免级联丢失沉淀）
--   + 部分索引（WHERE task_id IS NOT NULL，节省空间）
--   + 从 metadata->>'task_id' backfill 历史数据（只 backfill 在 tasks 表存在的）
--   不加 NOT NULL：部分入口（对话洞察、跨任务总结）天然没有具体 task_id 上下文，
--   且历史数据 backfill 不可能 100% 覆盖。物理强制由应用层（learning.js
--   recordLearning 等）+ FK 引用完整性共同保证。

ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS task_id UUID;

-- Backfill：从 metadata.task_id 提取，且只填那些在 tasks 表存在的（否则后续 FK 会失败）
UPDATE learnings l
  SET task_id = (l.metadata->>'task_id')::uuid
  WHERE l.task_id IS NULL
    AND l.metadata ? 'task_id'
    AND l.metadata->>'task_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND EXISTS (
      SELECT 1 FROM tasks t WHERE t.id = (l.metadata->>'task_id')::uuid
    );

-- 加 FK：任务删除时 SET NULL（保留 learning 沉淀）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'learnings_task_id_fkey'
  ) THEN
    ALTER TABLE learnings
      ADD CONSTRAINT learnings_task_id_fkey
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 部分索引：按 task_id 查 learning 时提速，只索引非空，节省空间
CREATE INDEX IF NOT EXISTS idx_learnings_task_id
  ON learnings(task_id)
  WHERE task_id IS NOT NULL;

COMMENT ON COLUMN learnings.task_id IS
  '触发该 learning 的 task ID。物理绑定洞察层 → 行动层。'
  '部分入口（对话洞察、跨任务总结）可空。'
  '替代 metadata->>task_id 这一脆弱软引用（learning_id 292f5859 fix）。';

INSERT INTO schema_version (version, description)
VALUES ('270', 'learnings 加 task_id 列 + FK + backfill，物理绑定洞察→行动 (learning 292f5859)')
ON CONFLICT (version) DO NOTHING;
