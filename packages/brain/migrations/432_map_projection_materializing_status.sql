-- Migration 432: 投影物化两阶段原子化 — 放开 map_projection_runs.status CHECK 纳入 'materializing'。
--
-- 背景：projector.runProjection 改为两阶段——新 run 先以 'materializing' 中间态写入并全量
-- 物化节点/边，随后在同一事务内翻转 new='active' + 旧 active='superseded'。'materializing'
-- 中间态（及物化中途崩溃留下的残行）对读取侧永不可见（getActiveProjection 只选 active，
-- getProjectionForRevision 只选 active/superseded），杜绝换代窗口内读到「部分集」半张图。
--
-- 本迁移只放开约束，不删除既有状态值：'building' 仍合法（map-projection-store.js 旧路径沿用）。

-- status 值域：新增 'materializing'
ALTER TABLE map_projection_runs
  DROP CONSTRAINT IF EXISTS map_projection_runs_status_check;

ALTER TABLE map_projection_runs
  ADD CONSTRAINT map_projection_runs_status_check
  CHECK (status IN ('building', 'materializing', 'active', 'superseded', 'failed'));

-- activation shape：'materializing' 归入 activated_at IS NULL 分支（尚未翻转 active）
ALTER TABLE map_projection_runs
  DROP CONSTRAINT IF EXISTS map_projection_run_activation_shape;

ALTER TABLE map_projection_runs
  ADD CONSTRAINT map_projection_run_activation_shape CHECK (
    (status IN ('active', 'superseded') AND activated_at IS NOT NULL)
    OR (status IN ('building', 'failed', 'materializing') AND activated_at IS NULL)
  );

INSERT INTO schema_version (version, description)
VALUES ('432', 'Widen map_projection_runs.status to include materializing (two-phase atomic projection)')
ON CONFLICT (version) DO NOTHING;
