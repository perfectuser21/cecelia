-- Migration 263: learnings.dispatch_constraint — 把洞察转化成调度阶段的硬规则
-- 背景：cortex_insight 写入后只是记录，没有任何机制把它变成 dispatch gate 的硬规则。
-- 等于每次 tick 都重新学习相同教训。本表添加一个 JSONB 列存放约束 DSL，
-- pre-flight-check 在派发前会加载所有非空 dispatch_constraint 并对当前 task 求值。
--
-- DSL v1（最简，仅三种规则；后续可扩展）：
--   {"rule":"deny_keyword",   "field":"title|description", "patterns":["..."], "reason":"...", "severity":"block|warn"}
--   {"rule":"require_field",  "field":"title|description", "min_length":N,    "reason":"...", "severity":"block|warn"}
--   {"rule":"require_payload","key":"keyA.keyB",                              "reason":"...", "severity":"block|warn"}
--
-- 写入：cortex 生成 insight 时附带 dispatch_constraint，或人工通过 API 后置补充。

ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS dispatch_constraint JSONB;

CREATE INDEX IF NOT EXISTS idx_learnings_dispatch_constraint
  ON learnings ((dispatch_constraint IS NOT NULL))
  WHERE dispatch_constraint IS NOT NULL;

COMMENT ON COLUMN learnings.dispatch_constraint IS
  '把 insight 转化成 pre-flight 阶段的硬规则；NULL=尚未转化，非 NULL=激活态约束';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('263', 'learnings.dispatch_constraint: convert insights into pre-flight constraints', NOW())
ON CONFLICT DO NOTHING;
