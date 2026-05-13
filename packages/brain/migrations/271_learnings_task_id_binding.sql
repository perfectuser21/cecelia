-- Migration: 271_learnings_task_id_binding
-- Purpose: 把 task_id 从 metadata JSONB "知识文档层" 提升到 learnings 表的一等列，
--         形成代码层防御 —— 让 task_id 缺失成为可索引、可统计、可告警的硬事实。
--
-- 背景：Cortex Insight 三次复现 "Insight-to-Action 断裂"，根因都是 learning 入库
--      不强制绑定 task_id，知识与具体任务脱钩，无法形成闭环。
--      learnings-received 路由 (routes/tasks.js:228) 已接收 task_id 参数，
--      但 INSERT 语句完全丢弃了它（line 262-269）—— 这是最典型的"接收但不存"漏洞。
--
-- 改动：
--   1. ALTER TABLE learnings ADD COLUMN task_id（nullable，外键 ON DELETE SET NULL）
--   2. 回填历史 metadata->>'task_id'（仅当字段格式为 UUID 且 tasks 表存在该 id）
--   3. 加索引 idx_learnings_task_id（支持按 task 反查 learnings）
--
-- 为何 nullable：
--   - conversation_insight / 自动对话总结类 learning 没有具体 task（合理空）
--   - 历史 NULL 数据兼容
--   - 应用层在已知 task_id 的路径（learnings-received / recordLearning）强制写入
--     并对 NULL 情况告警，而不是 DB CHECK 强约束（避免阻塞老路径）

BEGIN;

ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_learnings_task_id ON learnings(task_id);

-- 回填：metadata.task_id 是 UUID 且在 tasks 表存在
UPDATE learnings l
   SET task_id = (l.metadata->>'task_id')::uuid
  FROM tasks t
 WHERE l.task_id IS NULL
   AND l.metadata ? 'task_id'
   AND l.metadata->>'task_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   AND (l.metadata->>'task_id')::uuid = t.id;

INSERT INTO schema_version (version, description)
VALUES ('271', '把 task_id 从 learnings.metadata 提升为列 + 回填历史数据 + 索引');

COMMIT;
