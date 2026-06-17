-- Migration 300: harness_initiative 任务 → okr_initiatives 数据合一（PR 2b-2a，纯加）
-- 双轴模型：把执行侧 228 个 task_type='harness_initiative' 的任务对齐到规划侧 okr_initiatives，
-- 并把 initiative_runs 挂到 okr_initiatives。为 2b-2b 行为切换（harness 认领 okr_initiatives）铺路。
--
-- ⚠️ 纯加 / 完全可逆 / 零代码零行为变更：
--   - 只新增（映射表 + 228 行 okr_initiatives + initiative_runs 一个新列）
--   - 不改/不删任何现有数据；initiative_runs.initiative_id 原样保留（双跑兼容 + 回滚）
-- 参见 docs/superpowers/specs/2026-06-10-phase2b-initiative-unify-prd.md §3 PR 2b-2
--
-- 回滚：DROP TABLE harness_initiative_migration_map;
--       DELETE FROM okr_initiatives WHERE custom_props->>'source'='harness_migration_2b2a';
--       ALTER TABLE initiative_runs DROP COLUMN okr_initiative_id;

-- 1. 映射表：旧 harness task id → 新 okr_initiative id（双跑期两侧对照）
CREATE TABLE IF NOT EXISTS harness_initiative_migration_map (
  harness_task_id   UUID PRIMARY KEY,
  okr_initiative_id UUID NOT NULL,
  migrated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 为每个尚未迁移的 harness_initiative 任务建一行 okr_initiatives（显式给 status，
--    因 299 的 CHECK 已禁止默认值 'pending'）。AS MATERIALIZED 固定 gen_random_uuid()，
--    保证 okr_initiatives 与映射表写入同一 id。
WITH to_migrate AS MATERIALIZED (
  SELECT
    t.id              AS task_id,
    gen_random_uuid() AS new_init_id,
    t.title, t.status AS task_status,
    -- 仅携带有效 project_id（okr_initiatives.project_id 有 FK→okr_projects）；
    -- harness 任务的 project_id 可能指向已不存在/别表的 id → 置 NULL 避免 FK 违例
    CASE WHEN t.project_id IN (SELECT id FROM okr_projects) THEN t.project_id ELSE NULL END AS project_id,
    t.description,
    t.created_at, t.completed_at
  FROM tasks t
  WHERE t.task_type = 'harness_initiative'
    AND NOT EXISTS (
      SELECT 1 FROM harness_initiative_migration_map m WHERE m.harness_task_id = t.id
    )
),
ins_init AS (
  INSERT INTO okr_initiatives
    (id, title, status, project_id, description, created_at, updated_at, completed_at, custom_props)
  SELECT
    new_init_id,
    COALESCE(NULLIF(title, ''), '(untitled harness initiative)'),
    CASE task_status
      WHEN 'completed' THEN 'done'
      WHEN 'failed'    THEN 'failed'
      WHEN 'canceled'  THEN 'cancelled'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'archived'  THEN 'archived'
      WHEN 'queued'    THEN 'queued'
      ELSE 'failed'  -- 兜底：未知状态归终态 failed，不会被 harness 误认领
    END,
    project_id, description, created_at, now(), completed_at,
    jsonb_build_object('source', 'harness_migration_2b2a', 'harness_task_id', task_id)
  FROM to_migrate
  RETURNING 1
)
INSERT INTO harness_initiative_migration_map (harness_task_id, okr_initiative_id)
SELECT task_id, new_init_id FROM to_migrate;

-- 3. initiative_runs 加 okr_initiative_id 列（可空，additive），回填指向。
--    initiative_id 原样保留——2b-2b 切读 okr_initiative_id，最终再下线旧列。
ALTER TABLE initiative_runs ADD COLUMN IF NOT EXISTS okr_initiative_id UUID;

-- 3a. 指向 harness task 的 run → 经映射表回填
UPDATE initiative_runs ir
SET okr_initiative_id = m.okr_initiative_id
FROM harness_initiative_migration_map m
WHERE ir.initiative_id = m.harness_task_id
  AND ir.okr_initiative_id IS NULL;

-- 3b. 已直接指向 okr_initiatives 的 run → 直通复制
UPDATE initiative_runs ir
SET okr_initiative_id = ir.initiative_id
WHERE ir.okr_initiative_id IS NULL
  AND ir.initiative_id IN (SELECT id FROM okr_initiatives);

CREATE INDEX IF NOT EXISTS idx_initiative_runs_okr_initiative_id
  ON initiative_runs(okr_initiative_id);
