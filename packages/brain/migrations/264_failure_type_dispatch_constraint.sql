-- Migration 264: 把 learning_id 6a569a1e 的 failure_type 分类路由 insight 物化为 dispatch_constraint
-- 背景：
--   Cortex Insight 6a569a1e 提出"failure_type 分类路由是 dispatch 层 P0 需求：
--   TRANSIENT/PERMANENT_DEPENDENCY/STRUCTURAL 三类失败处理路径完全不同，
--   统一 retry 路由是系统性资源浪费的根源"。
--   migration 263 建立了 insight→constraint 通路，本迁移把这条 insight 落地。
--
-- DSL 扩展：deny_payload — 基于 payload 值的分类拒绝（在 insight-constraints.js 同步加入）。
--
-- 失败类映射（来自 dev-failure-classifier.js DEV_FAILURE_CLASS）：
--   TRANSIENT             ← 'transient'                       — 可重试
--   PERMANENT_DEPENDENCY  ← 'auth' / 'resource'              — 不可重试，需人工
--   STRUCTURAL            ← 'env_broken'                      — 不可重试，需修部署
--   UNKNOWN               ← 'unknown'                          — 不可重试，无法识别
--
-- 约束语义：retry 任务 payload.previous_failure.class 命中后三类时阻止派发；
-- TRANSIENT 与无 previous_failure（新任务）正常通过。

UPDATE learnings
SET dispatch_constraint = jsonb_build_object(
  'rule', 'deny_payload',
  'key', 'previous_failure.class',
  'values', jsonb_build_array('auth', 'resource', 'env_broken', 'unknown'),
  'reason', 'failure_type 分类路由：PERMANENT_DEPENDENCY/STRUCTURAL/UNKNOWN 永不应 retry，统一 retry 是浪费根源',
  'severity', 'block'
)
WHERE id = '6a569a1e-83c4-4052-a05a-59b2a09840a8'
  AND dispatch_constraint IS NULL;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('264', 'failure_type dispatch constraint: convert insight 6a569a1e into deny_payload rule', NOW())
ON CONFLICT DO NOTHING;
