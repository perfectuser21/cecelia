-- Migration 237: Harness v2 新表 task_dependencies
-- PRD: docs/design/harness-v2-prd.md §4.3
-- 用途：显式存 Task DAG 的边（runtime 拓扑排序）
-- 注：pr_plans.depends_on 保留（dashboard 展示），task_dependencies 给 tick 用
-- 循环依赖：本 migration 只防自环（A→A），A→B→A 两跳环由 runtime CTE 检测

CREATE TABLE IF NOT EXISTS task_dependencies (
  from_task_id UUID NOT NULL,
  to_task_id UUID NOT NULL,
  edge_type TEXT NOT NULL DEFAULT 'hard'
    CHECK (edge_type IN ('hard','soft')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (from_task_id, to_task_id),
  CHECK (from_task_id != to_task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_deps_from ON task_dependencies(from_task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_to   ON task_dependencies(to_task_id);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('237', 'Harness v2: task_dependencies 表（DAG 边表，防自环）', NOW())
ON CONFLICT (version) DO NOTHING;
