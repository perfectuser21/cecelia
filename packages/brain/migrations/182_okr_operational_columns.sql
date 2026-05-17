-- Migration 182: 新 OKR 表补充运营列
-- 为 visions / objectives / key_results / okr_projects / okr_scopes / okr_initiatives
-- 补充业务代码所需的运营字段，解锁后续代码从旧 goals/projects 表向新表迁移
--
-- 列分配策略（按层级）：
--   visions         → description
--   objectives      → description, priority
--   key_results     → description, priority, progress, weight
--   okr_projects    → description, progress, completed_at
--   okr_scopes      → description, progress, completed_at
--   okr_initiatives → description, priority, progress, starvation_score, completed_at, last_dispatch_at
--
-- 同时更新 migration 181 创建的触发器函数，同步这些新列

-- ============================================================
-- 1. visions
-- ============================================================

ALTER TABLE visions
  ADD COLUMN IF NOT EXISTS description TEXT;

-- ============================================================
-- 2. objectives
-- ============================================================

ALTER TABLE objectives
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS priority    VARCHAR(10) DEFAULT 'P1';

-- ============================================================
-- 3. key_results
-- ============================================================

ALTER TABLE key_results
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS priority    VARCHAR(10)    DEFAULT 'P1',
  ADD COLUMN IF NOT EXISTS progress    INTEGER        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weight      NUMERIC(3,2)   DEFAULT 1.0;

-- ============================================================
-- 4. okr_projects
-- ============================================================

ALTER TABLE okr_projects
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS progress    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- ============================================================
-- 5. okr_scopes
-- ============================================================

ALTER TABLE okr_scopes
  ADD COLUMN IF NOT EXISTS description  TEXT,
  ADD COLUMN IF NOT EXISTS progress     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- ============================================================
-- 6. okr_initiatives
-- ============================================================

ALTER TABLE okr_initiatives
  ADD COLUMN IF NOT EXISTS description      TEXT,
  ADD COLUMN IF NOT EXISTS priority         VARCHAR(10) DEFAULT 'P1',
  ADD COLUMN IF NOT EXISTS progress         INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starvation_score INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_dispatch_at TIMESTAMPTZ;

-- ============================================================
-- 7. 更新触发器函数：sync_goal_to_okr_tables
--    重新创建以包含新列同步
-- ============================================================

CREATE OR REPLACE FUNCTION sync_goal_to_okr_tables()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_parent_vision_id    uuid;
  v_parent_objective_id uuid;
BEGIN
  -- ── DELETE ──────────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    BEGIN
      DELETE FROM visions     WHERE id = OLD.id;
      DELETE FROM objectives  WHERE id = OLD.id;
      DELETE FROM key_results WHERE id = OLD.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[migration182] goals DELETE sync failed for id=%: %', OLD.id, SQLERRM;
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
        id, title, description, status, area_id, owner_role,
        end_date, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        NEW.title,
        NEW.description,
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
        title       = EXCLUDED.title,
        description = EXCLUDED.description,
        status      = EXCLUDED.status,
        area_id     = EXCLUDED.area_id,
        owner_role  = EXCLUDED.owner_role,
        end_date    = EXCLUDED.end_date,
        metadata    = EXCLUDED.metadata,
        updated_at  = EXCLUDED.updated_at;

    ELSIF NEW.type = 'area_okr' THEN
      SELECT id INTO v_parent_vision_id FROM visions WHERE id = NEW.parent_id;

      INSERT INTO objectives (
        id, vision_id, title, description, priority, status, area_id, owner_role,
        end_date, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        v_parent_vision_id,
        NEW.title,
        NEW.description,
        COALESCE(NEW.priority, 'P1'),
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
        vision_id   = EXCLUDED.vision_id,
        title       = EXCLUDED.title,
        description = EXCLUDED.description,
        priority    = EXCLUDED.priority,
        status      = EXCLUDED.status,
        area_id     = EXCLUDED.area_id,
        owner_role  = EXCLUDED.owner_role,
        end_date    = EXCLUDED.end_date,
        metadata    = EXCLUDED.metadata,
        updated_at  = EXCLUDED.updated_at;

    ELSIF NEW.type IN ('area_kr', 'global_kr') THEN
      SELECT id INTO v_parent_objective_id FROM objectives WHERE id = NEW.parent_id;

      INSERT INTO key_results (
        id, objective_id, title, description, priority, progress, weight,
        status, area_id, owner_role,
        end_date, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        v_parent_objective_id,
        NEW.title,
        NEW.description,
        COALESCE(NEW.priority, 'P1'),
        COALESCE(NEW.progress, 0),
        COALESCE(NEW.weight, 1.0),
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
        description  = EXCLUDED.description,
        priority     = EXCLUDED.priority,
        progress     = EXCLUDED.progress,
        weight       = EXCLUDED.weight,
        status       = EXCLUDED.status,
        area_id      = EXCLUDED.area_id,
        owner_role   = EXCLUDED.owner_role,
        end_date     = EXCLUDED.end_date,
        metadata     = EXCLUDED.metadata,
        updated_at   = EXCLUDED.updated_at;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[migration182] goals % sync failed for id=%, type=%: %',
      TG_OP, NEW.id, NEW.type, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 8. 更新触发器函数：sync_project_to_okr_tables
-- ============================================================

CREATE OR REPLACE FUNCTION sync_project_to_okr_tables()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_project_id uuid;
  v_parent_scope_id   uuid;
BEGIN
  -- ── DELETE ──────────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    BEGIN
      DELETE FROM okr_projects   WHERE id = OLD.id;
      DELETE FROM okr_scopes     WHERE id = OLD.id;
      DELETE FROM okr_initiatives WHERE id = OLD.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[migration182] projects DELETE sync failed for id=%: %', OLD.id, SQLERRM;
    END;
    RETURN OLD;
  END IF;

  -- ── INSERT / UPDATE ──────────────────────────────────────
  BEGIN
    IF NEW.type = 'project' THEN
      INSERT INTO okr_projects (
        id, kr_id, title, description, progress, status, area_id, owner_role,
        end_date, completed_at, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        NULL,
        NEW.name,
        NEW.description,
        0,
        COALESCE(NEW.status, 'planning'),
        NEW.area_id,
        NEW.owner_role,
        NEW.deadline,
        NEW.completed_at,
        NEW.metadata,
        '{}',
        NEW.created_at,
        NEW.updated_at
      )
      ON CONFLICT (id) DO UPDATE SET
        title        = EXCLUDED.title,
        description  = EXCLUDED.description,
        progress     = EXCLUDED.progress,
        status       = EXCLUDED.status,
        area_id      = EXCLUDED.area_id,
        owner_role   = EXCLUDED.owner_role,
        end_date     = EXCLUDED.end_date,
        completed_at = EXCLUDED.completed_at,
        metadata     = EXCLUDED.metadata,
        updated_at   = EXCLUDED.updated_at;

    ELSIF NEW.type = 'scope' THEN
      SELECT id INTO v_parent_project_id FROM okr_projects WHERE id = NEW.parent_id;

      INSERT INTO okr_scopes (
        id, project_id, title, description, progress, status, area_id, owner_role,
        end_date, completed_at, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        v_parent_project_id,
        NEW.name,
        NEW.description,
        0,
        COALESCE(NEW.status, 'planning'),
        NEW.area_id,
        NEW.owner_role,
        NEW.deadline,
        NEW.completed_at,
        NEW.metadata,
        '{}',
        NEW.created_at,
        NEW.updated_at
      )
      ON CONFLICT (id) DO UPDATE SET
        project_id   = EXCLUDED.project_id,
        title        = EXCLUDED.title,
        description  = EXCLUDED.description,
        progress     = EXCLUDED.progress,
        status       = EXCLUDED.status,
        area_id      = EXCLUDED.area_id,
        owner_role   = EXCLUDED.owner_role,
        end_date     = EXCLUDED.end_date,
        completed_at = EXCLUDED.completed_at,
        metadata     = EXCLUDED.metadata,
        updated_at   = EXCLUDED.updated_at;

    ELSIF NEW.type = 'initiative' THEN
      SELECT id INTO v_parent_scope_id FROM okr_scopes WHERE id = NEW.parent_id;

      INSERT INTO okr_initiatives (
        id, scope_id, title, description, priority, progress, starvation_score,
        status, area_id, owner_role,
        end_date, completed_at, last_dispatch_at, metadata, custom_props, created_at, updated_at
      ) VALUES (
        NEW.id,
        v_parent_scope_id,
        NEW.name,
        NEW.description,
        'P1',
        0,
        0,
        COALESCE(NEW.status, 'pending'),
        NEW.area_id,
        NEW.owner_role,
        NEW.deadline,
        NEW.completed_at,
        NULL,
        NEW.metadata,
        '{}',
        NEW.created_at,
        NEW.updated_at
      )
      ON CONFLICT (id) DO UPDATE SET
        scope_id         = EXCLUDED.scope_id,
        title            = EXCLUDED.title,
        description      = EXCLUDED.description,
        priority         = EXCLUDED.priority,
        progress         = EXCLUDED.progress,
        starvation_score = EXCLUDED.starvation_score,
        status           = EXCLUDED.status,
        area_id          = EXCLUDED.area_id,
        owner_role       = EXCLUDED.owner_role,
        end_date         = EXCLUDED.end_date,
        completed_at     = EXCLUDED.completed_at,
        last_dispatch_at = EXCLUDED.last_dispatch_at,
        metadata         = EXCLUDED.metadata,
        updated_at       = EXCLUDED.updated_at;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[migration182] projects % sync failed for id=%, type=%: %',
      TG_OP, NEW.id, NEW.type, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 9. schema_version
-- ============================================================

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '182',
  'OKR 新表补充运营列：description/priority/progress/starvation_score/completed_at/last_dispatch_at；更新双向同步触发器',
  now()
)
ON CONFLICT (version) DO NOTHING;
