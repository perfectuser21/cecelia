-- Migration 180: OKR 双向同步触发器
-- 在旧 goals / projects 表上创建 AFTER INSERT/UPDATE/DELETE 触发器
-- 将每次写操作自动同步到新 OKR 层级表
--
-- 触发映射：
--   goals(type=vision)       → visions
--   goals(type=area_okr)     → objectives
--   goals(type=area_kr|global_kr) → key_results
--   projects(type=project)   → okr_projects
--   projects(type=scope)     → okr_scopes
--   projects(type=initiative)→ okr_initiatives
--
-- 安全设计：
--   - EXCEPTION WHEN OTHERS → RAISE WARNING，不阻断原始操作
--   - INSERT ON CONFLICT DO UPDATE 保证幂等
--   - DELETE 级联由新表 FK CASCADE 自动处理

-- ============================================================
-- 1. goals 触发器函数
-- ============================================================

CREATE OR REPLACE FUNCTION sync_goal_to_okr_tables()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_parent_vision_id uuid;
  v_parent_objective_id uuid;
BEGIN
  -- ── DELETE ──────────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    BEGIN
      DELETE FROM visions       WHERE id = OLD.id;
      DELETE FROM objectives    WHERE id = OLD.id;
      DELETE FROM key_results   WHERE id = OLD.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[migration180] goals DELETE sync failed for id=%: %', OLD.id, SQLERRM;
    END;
    RETURN OLD;
  END IF;

  -- ── 状态映射 ─────────────────────────────────────────────
  v_status := CASE
    WHEN NEW.status = 'in_progress' THEN 'active'
    WHEN NEW.status = 'active'      THEN 'active'
    WHEN NEW.status = 'cancelled'   THEN 'cancelled'
    WHEN NEW.status = 'completed'   THEN 'completed'
    ELSE 'active'
  END;

  -- ── INSERT / UPDATE ──────────────────────────────────────
  BEGIN
    IF NEW.type = 'vision' THEN
      INSERT INTO visions (
        id, title, status, area_id, owner_role,
        end_date, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        NEW.title,
        v_status,
        NEW.area_id,
        NEW.owner_role,
        NEW.target_date,
        NEW.metadata,
        '{}',
        NEW.created_at,
        NEW.updated_at
      )
      ON CONFLICT (id) DO UPDATE SET
        title      = EXCLUDED.title,
        status     = EXCLUDED.status,
        area_id    = EXCLUDED.area_id,
        owner_role = EXCLUDED.owner_role,
        end_date   = EXCLUDED.end_date,
        metadata   = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at;

    ELSIF NEW.type = 'area_okr' THEN
      -- vision_id: 仅当 parent 在 visions 中才设置
      SELECT id INTO v_parent_vision_id FROM visions WHERE id = NEW.parent_id;

      INSERT INTO objectives (
        id, vision_id, title, status, area_id, owner_role,
        end_date, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        v_parent_vision_id,
        NEW.title,
        v_status,
        NEW.area_id,
        NEW.owner_role,
        NEW.target_date,
        NEW.metadata,
        '{}',
        NEW.created_at,
        NEW.updated_at
      )
      ON CONFLICT (id) DO UPDATE SET
        vision_id  = EXCLUDED.vision_id,
        title      = EXCLUDED.title,
        status     = EXCLUDED.status,
        area_id    = EXCLUDED.area_id,
        owner_role = EXCLUDED.owner_role,
        end_date   = EXCLUDED.end_date,
        metadata   = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at;

    ELSIF NEW.type IN ('area_kr', 'global_kr') THEN
      -- objective_id: 仅当 parent 在 objectives 中才设置
      SELECT id INTO v_parent_objective_id FROM objectives WHERE id = NEW.parent_id;

      INSERT INTO key_results (
        id, objective_id, title, status, area_id, owner_role,
        end_date, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        v_parent_objective_id,
        NEW.title,
        COALESCE(v_status, 'pending'),
        NEW.area_id,
        NEW.owner_role,
        NEW.target_date,
        NEW.metadata,
        '{}',
        NEW.created_at,
        NEW.updated_at
      )
      ON CONFLICT (id) DO UPDATE SET
        objective_id = EXCLUDED.objective_id,
        title        = EXCLUDED.title,
        status       = EXCLUDED.status,
        area_id      = EXCLUDED.area_id,
        owner_role   = EXCLUDED.owner_role,
        end_date     = EXCLUDED.end_date,
        metadata     = EXCLUDED.metadata,
        updated_at   = EXCLUDED.updated_at;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[migration180] goals % sync failed for id=%, type=%: %',
      TG_OP, NEW.id, NEW.type, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. projects 触发器函数
-- ============================================================

CREATE OR REPLACE FUNCTION sync_project_to_okr_tables()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_kr_id       uuid;
  v_parent_project_id  uuid;
  v_parent_scope_id    uuid;
BEGIN
  -- ── DELETE ──────────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    BEGIN
      DELETE FROM okr_projects   WHERE id = OLD.id;
      DELETE FROM okr_scopes     WHERE id = OLD.id;
      DELETE FROM okr_initiatives WHERE id = OLD.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[migration180] projects DELETE sync failed for id=%: %', OLD.id, SQLERRM;
    END;
    RETURN OLD;
  END IF;

  -- ── INSERT / UPDATE ──────────────────────────────────────
  BEGIN
    IF NEW.type = 'project' THEN
      -- kr_id: 旧数据 goal_id 指向 objectives 而非 key_results，故置 NULL
      INSERT INTO okr_projects (
        id, kr_id, title, status, area_id, owner_role,
        end_date, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        NULL,
        NEW.name,
        COALESCE(NEW.status, 'planning'),
        NEW.area_id,
        NEW.owner_role,
        NEW.deadline,
        NEW.metadata,
        '{}',
        NEW.created_at,
        NEW.updated_at
      )
      ON CONFLICT (id) DO UPDATE SET
        title      = EXCLUDED.title,
        status     = EXCLUDED.status,
        area_id    = EXCLUDED.area_id,
        owner_role = EXCLUDED.owner_role,
        end_date   = EXCLUDED.end_date,
        metadata   = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at;

    ELSIF NEW.type = 'scope' THEN
      -- project_id: 仅当 parent 在 okr_projects 中才设置
      SELECT id INTO v_parent_project_id FROM okr_projects WHERE id = NEW.parent_id;

      INSERT INTO okr_scopes (
        id, project_id, title, status, area_id, owner_role,
        end_date, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        v_parent_project_id,
        NEW.name,
        COALESCE(NEW.status, 'planning'),
        NEW.area_id,
        NEW.owner_role,
        NEW.deadline,
        NEW.metadata,
        '{}',
        NEW.created_at,
        NEW.updated_at
      )
      ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        title      = EXCLUDED.title,
        status     = EXCLUDED.status,
        area_id    = EXCLUDED.area_id,
        owner_role = EXCLUDED.owner_role,
        end_date   = EXCLUDED.end_date,
        metadata   = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at;

    ELSIF NEW.type = 'initiative' THEN
      -- scope_id: 仅当 parent 在 okr_scopes 中才设置
      SELECT id INTO v_parent_scope_id FROM okr_scopes WHERE id = NEW.parent_id;

      INSERT INTO okr_initiatives (
        id, scope_id, title, status, area_id, owner_role,
        end_date, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        v_parent_scope_id,
        NEW.name,
        COALESCE(NEW.status, 'pending'),
        NEW.area_id,
        NEW.owner_role,
        NEW.deadline,
        NEW.metadata,
        '{}',
        NEW.created_at,
        NEW.updated_at
      )
      ON CONFLICT (id) DO UPDATE SET
        scope_id   = EXCLUDED.scope_id,
        title      = EXCLUDED.title,
        status     = EXCLUDED.status,
        area_id    = EXCLUDED.area_id,
        owner_role = EXCLUDED.owner_role,
        end_date   = EXCLUDED.end_date,
        metadata   = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[migration180] projects % sync failed for id=%, type=%: %',
      TG_OP, NEW.id, NEW.type, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. 创建触发器（幂等：先 DROP IF EXISTS）
-- ============================================================

-- goals 触发器（INSERT + UPDATE + DELETE 各一个）
DROP TRIGGER IF EXISTS goals_after_insert_sync ON goals;
CREATE TRIGGER goals_after_insert_sync
  AFTER INSERT ON goals
  FOR EACH ROW EXECUTE FUNCTION sync_goal_to_okr_tables();

DROP TRIGGER IF EXISTS goals_after_update_sync ON goals;
CREATE TRIGGER goals_after_update_sync
  AFTER UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION sync_goal_to_okr_tables();

DROP TRIGGER IF EXISTS goals_after_delete_sync ON goals;
CREATE TRIGGER goals_after_delete_sync
  AFTER DELETE ON goals
  FOR EACH ROW EXECUTE FUNCTION sync_goal_to_okr_tables();

-- projects 触发器（INSERT + UPDATE + DELETE 各一个）
DROP TRIGGER IF EXISTS projects_after_insert_sync ON projects;
CREATE TRIGGER projects_after_insert_sync
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION sync_project_to_okr_tables();

DROP TRIGGER IF EXISTS projects_after_update_sync ON projects;
CREATE TRIGGER projects_after_update_sync
  AFTER UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION sync_project_to_okr_tables();

DROP TRIGGER IF EXISTS projects_after_delete_sync ON projects;
CREATE TRIGGER projects_after_delete_sync
  AFTER DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION sync_project_to_okr_tables();

-- ============================================================
-- 4. schema_version
-- ============================================================

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '180',
  'OKR 双向同步触发器：goals/projects AFTER INSERT/UPDATE/DELETE → visions/objectives/key_results/okr_projects/okr_scopes/okr_initiatives',
  now()
)
ON CONFLICT (version) DO NOTHING;
