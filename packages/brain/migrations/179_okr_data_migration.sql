-- Migration 179: 完整数据迁移 — 旧 goals/projects 表搬入新 OKR 层级表
-- goals(type=vision)      → visions
-- goals(type=area_okr)    → objectives
-- goals(type=area_kr)     → key_results（当前无此类型，保留映射备用）
-- goals(type=global_kr)   → key_results（当前无此类型，保留映射备用）
-- projects(type=project)  → okr_projects
-- projects(type=scope)    → okr_scopes
-- projects(type=initiative)→ okr_initiatives
--
-- 幂等性：所有 INSERT 使用 ON CONFLICT (id) DO NOTHING
-- 旧表：保留数据，添加 DEPRECATED 注释（不删除，留给 PR5）
-- FK 处理：nullable FK 在无法满足引用完整性时置 NULL

-- ===================== 1. goals type='vision' → visions =====================

INSERT INTO visions (
  id,
  title,
  status,
  area_id,
  owner_role,
  end_date,
  metadata,
  custom_props,
  created_at,
  updated_at
)
SELECT
  g.id,
  g.title,
  CASE
    WHEN g.status = 'in_progress' THEN 'active'
    WHEN g.status = 'cancelled'   THEN 'cancelled'
    ELSE 'active'
  END AS status,
  g.area_id,
  g.owner_role,
  g.target_date AS end_date,
  g.metadata,
  '{}'::jsonb AS custom_props,
  g.created_at,
  g.updated_at
FROM goals g
WHERE g.type = 'vision'
ON CONFLICT (id) DO NOTHING;

-- ===================== 2. goals type='area_okr' → objectives =====================
-- vision_id: 仅当 parent_id 指向一个已在 visions 表中的记录时才填写，否则 NULL

INSERT INTO objectives (
  id,
  vision_id,
  title,
  status,
  area_id,
  owner_role,
  end_date,
  metadata,
  custom_props,
  created_at,
  updated_at
)
SELECT
  g.id,
  CASE
    WHEN v.id IS NOT NULL THEN g.parent_id
    ELSE NULL
  END AS vision_id,
  g.title,
  CASE
    WHEN g.status = 'in_progress' THEN 'in_progress'
    WHEN g.status = 'cancelled'   THEN 'cancelled'
    ELSE 'pending'
  END AS status,
  g.area_id,
  g.owner_role,
  g.target_date AS end_date,
  g.metadata,
  '{}'::jsonb AS custom_props,
  g.created_at,
  g.updated_at
FROM goals g
LEFT JOIN visions v ON v.id = g.parent_id
WHERE g.type = 'area_okr'
ON CONFLICT (id) DO NOTHING;

-- ===================== 3. goals type='area_kr' → key_results（幂等备用） =====================
-- 当前数据库中不存在此类型，INSERT 为空操作；保留以备将来数据出现

INSERT INTO key_results (
  id,
  objective_id,
  title,
  status,
  area_id,
  owner_role,
  end_date,
  metadata,
  custom_props,
  created_at,
  updated_at
)
SELECT
  g.id,
  CASE
    WHEN o.id IS NOT NULL THEN g.parent_id
    ELSE NULL
  END AS objective_id,
  g.title,
  COALESCE(g.status, 'pending') AS status,
  g.area_id,
  g.owner_role,
  g.target_date AS end_date,
  g.metadata,
  '{}'::jsonb AS custom_props,
  g.created_at,
  g.updated_at
FROM goals g
LEFT JOIN objectives o ON o.id = g.parent_id
WHERE g.type IN ('area_kr', 'global_kr')
ON CONFLICT (id) DO NOTHING;

-- ===================== 4. projects type='project' → okr_projects =====================
-- kr_id: 旧数据的 goal_id 指向 area_okr（现在在 objectives 不在 key_results），
--        故 kr_id 置 NULL，避免 FK 违约。关联关系留给后续 PR 修复。

INSERT INTO okr_projects (
  id,
  kr_id,
  title,
  status,
  area_id,
  owner_role,
  end_date,
  metadata,
  custom_props,
  created_at,
  updated_at
)
SELECT
  p.id,
  NULL AS kr_id,
  p.name AS title,
  COALESCE(p.status, 'planning') AS status,
  p.area_id,
  p.owner_role,
  p.deadline AS end_date,
  p.metadata,
  '{}'::jsonb AS custom_props,
  p.created_at,
  p.updated_at
FROM projects p
WHERE p.type = 'project'
ON CONFLICT (id) DO NOTHING;

-- ===================== 5. projects type='scope' → okr_scopes =====================
-- project_id: parent_id 指向 type='project' 的 projects，
--             该记录应已在 okr_projects 中

INSERT INTO okr_scopes (
  id,
  project_id,
  title,
  status,
  area_id,
  owner_role,
  end_date,
  metadata,
  custom_props,
  created_at,
  updated_at
)
SELECT
  p.id,
  CASE
    WHEN op.id IS NOT NULL THEN p.parent_id
    ELSE NULL
  END AS project_id,
  p.name AS title,
  COALESCE(p.status, 'planning') AS status,
  p.area_id,
  p.owner_role,
  p.deadline AS end_date,
  p.metadata,
  '{}'::jsonb AS custom_props,
  p.created_at,
  p.updated_at
FROM projects p
LEFT JOIN okr_projects op ON op.id = p.parent_id
WHERE p.type = 'scope'
ON CONFLICT (id) DO NOTHING;

-- ===================== 6. projects type='initiative' → okr_initiatives =====================
-- scope_id:
--   - parent.type='scope'   → scope_id = parent_id（当该 scope 已在 okr_scopes 中）
--   - parent.type='project' → scope_id = NULL（parent 不是 scope，无法直接关联）
--   - parent IS NULL        → scope_id = NULL

INSERT INTO okr_initiatives (
  id,
  scope_id,
  title,
  status,
  area_id,
  owner_role,
  end_date,
  metadata,
  custom_props,
  created_at,
  updated_at
)
SELECT
  p.id,
  CASE
    WHEN parent_p.type = 'scope' AND os.id IS NOT NULL THEN p.parent_id
    ELSE NULL
  END AS scope_id,
  p.name AS title,
  COALESCE(p.status, 'pending') AS status,
  p.area_id,
  p.owner_role,
  p.deadline AS end_date,
  p.metadata,
  '{}'::jsonb AS custom_props,
  p.created_at,
  p.updated_at
FROM projects p
LEFT JOIN projects parent_p ON parent_p.id = p.parent_id
LEFT JOIN okr_scopes os ON os.id = p.parent_id
WHERE p.type = 'initiative'
ON CONFLICT (id) DO NOTHING;

-- ===================== 7. 旧表 DEPRECATED 注释 =====================
-- 旧表数据保留不删除，仅添加注释标记为已弃用
-- 实际删除操作由 PR5 执行

COMMENT ON TABLE goals IS 'deprecated（旧表）: 数据已迁移至 visions / objectives / key_results。此表将在 PR5 中删除。迁移时间：migration 179（2026-03）。';

COMMENT ON TABLE projects IS 'deprecated（旧表）: 数据已迁移至 okr_projects / okr_scopes / okr_initiatives。此表将在 PR5 中删除。迁移时间：migration 179（2026-03）。';

-- ===================== 8. 数据完整性验证（运行时校验，非阻断） =====================
-- 仅输出校验结果，不阻断 migration 执行

DO $$
DECLARE
  v_vision_expected   bigint;
  v_vision_actual     bigint;
  v_objective_expected bigint;
  v_objective_actual   bigint;
  v_project_expected  bigint;
  v_project_actual    bigint;
  v_scope_expected    bigint;
  v_scope_actual      bigint;
  v_initiative_expected bigint;
  v_initiative_actual   bigint;
BEGIN
  SELECT count(*) INTO v_vision_expected FROM goals WHERE type = 'vision';
  SELECT count(*) INTO v_vision_actual   FROM visions WHERE id IN (SELECT id FROM goals WHERE type = 'vision');

  SELECT count(*) INTO v_objective_expected FROM goals WHERE type = 'area_okr';
  SELECT count(*) INTO v_objective_actual   FROM objectives WHERE id IN (SELECT id FROM goals WHERE type = 'area_okr');

  SELECT count(*) INTO v_project_expected FROM projects WHERE type = 'project';
  SELECT count(*) INTO v_project_actual   FROM okr_projects WHERE id IN (SELECT id FROM projects WHERE type = 'project');

  SELECT count(*) INTO v_scope_expected FROM projects WHERE type = 'scope';
  SELECT count(*) INTO v_scope_actual   FROM okr_scopes WHERE id IN (SELECT id FROM projects WHERE type = 'scope');

  SELECT count(*) INTO v_initiative_expected FROM projects WHERE type = 'initiative';
  SELECT count(*) INTO v_initiative_actual   FROM okr_initiatives WHERE id IN (SELECT id FROM projects WHERE type = 'initiative');

  RAISE NOTICE '=== Migration 179 数据验证报告 ===';
  RAISE NOTICE 'visions:       期望 % 条，已迁 % 条 — %',
    v_vision_expected, v_vision_actual,
    CASE WHEN v_vision_actual = v_vision_expected THEN 'PASS' ELSE 'WARN' END;
  RAISE NOTICE 'objectives:    期望 % 条，已迁 % 条 — %',
    v_objective_expected, v_objective_actual,
    CASE WHEN v_objective_actual = v_objective_expected THEN 'PASS' ELSE 'WARN' END;
  RAISE NOTICE 'okr_projects:  期望 % 条，已迁 % 条 — %',
    v_project_expected, v_project_actual,
    CASE WHEN v_project_actual = v_project_expected THEN 'PASS' ELSE 'WARN' END;
  RAISE NOTICE 'okr_scopes:    期望 % 条，已迁 % 条 — %',
    v_scope_expected, v_scope_actual,
    CASE WHEN v_scope_actual = v_scope_expected THEN 'PASS' ELSE 'WARN' END;
  RAISE NOTICE 'okr_initiatives:期望 % 条，已迁 % 条 — %',
    v_initiative_expected, v_initiative_actual,
    CASE WHEN v_initiative_actual = v_initiative_expected THEN 'PASS' ELSE 'WARN' END;
  RAISE NOTICE '=== 验证完成 ===';
END $$;

-- ===================== 9. schema_version =====================
INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '179',
  '完整数据迁移：goals/projects → visions/objectives/key_results/okr_projects/okr_scopes/okr_initiatives（ON CONFLICT DO NOTHING，幂等）',
  now()
)
ON CONFLICT (version) DO NOTHING;
