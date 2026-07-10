-- Migration 331: decisions 表去重 + 历史垃圾清理
-- 问题：consciousness.graph.js 每 20 分钟调用 generateDecision()，
--       无论有无实质 actions 都无条件写入一行，topic/decision 均为 NULL，
--       造成 9.6 万+ 垃圾行。
-- 修法：
--   1. 清理历史垃圾（topic IS NULL AND decision IS NULL AND actions 为空数组或 NULL）
--   2. decision.js 代码层已加写前去重，此迁移只做一次性清理

DELETE FROM decisions
WHERE topic IS NULL
  AND decision IS NULL
  AND (actions IS NULL OR actions = '[]'::jsonb);

INSERT INTO schema_migrations (version, description, applied_at)
VALUES ('331', 'decisions 表去重清理历史空白 consciousness_loop 行', NOW())
ON CONFLICT (version) DO NOTHING;
