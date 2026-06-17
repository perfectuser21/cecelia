-- Migration 303: golden_path 重塑为唯一正模型（owner_task_id / order_no / feature_id / note）
-- 背景：旧 golden_path 是错模型（scope_type + scope_id + ability_id），把"一条线下多个 ability 排序"
--   当成 golden path，与 CLAUDE.md 唯一正模型（每个 Task 一条 Golden Path、owner_task_id、scope=那个 task）矛盾。
-- 正模型：golden_path.owner_task_id 指向某个 Task（= 1 ability），order_no 该 task 内步骤序号，
--   feature_id 指向该步所引用的 feature（journey_features）。
-- 表 0 行，可直接 DROP 旧表重建，无数据迁移（[ASSUMPTION] PRD 已确认）。
-- Evaluator 运行 E2E 前执行: psql $DB < packages/brain/migrations/303_golden_path_owner_task_model.sql

-- 旧表 FK→abilities，整表重建（CASCADE 清掉旧 index/约束）
DROP TABLE IF EXISTS golden_path CASCADE;

CREATE TABLE golden_path (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  order_no      INTEGER NOT NULL,
  feature_id    UUID REFERENCES journey_features(id) ON DELETE SET NULL,
  note          TEXT,
  notion_id     VARCHAR(100),
  notion_synced_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 按 task 整条 golden path 取步骤（owner_task_id 过滤 + order_no 排序）
CREATE INDEX IF NOT EXISTS idx_golden_path_owner_order ON golden_path(owner_task_id, order_no);
