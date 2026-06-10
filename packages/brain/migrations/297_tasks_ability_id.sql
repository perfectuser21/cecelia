-- Migration 297: 双轴模型 Phase 1 — Task→Ability 十字边
-- ability_id: 一条 GTD Task 实现能力台账（journey_features）里的哪个 Ability/Feature。
-- 执行轴 Task ←→ 能力轴 Ability 的十字连接。NULL 安全，不动任何现有列。
-- 参见 docs/superpowers/specs/2026-06-10-canonical-wbs-tree-design.md §3

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS ability_id UUID REFERENCES journey_features(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_ability_id ON tasks(ability_id);
