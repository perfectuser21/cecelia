-- Migration 497: Projects 真身表升格（接力棒链 2afa6d69 棒1，决策 ee4842a6 / 3feeae3e，任务 9e785997）
-- 编号勘误：本迁移先改过 495→496（撞 495_vs_model_spans.sql），又撞 496_probe_targets_cells_levels.sql，
-- 最终定号 497。
--
-- 主理人拍板：GTD 轴只保留四级 Objective → Key Result → Project → Task。Project 是独立表，
-- 不是 tasks.task_type='project' 的虚拟根。
--
-- ⚠️ 勘误（任务简报里的"事实"有误，本迁移已核实修正）：000_base 确实建过 projects 表，
--    但迁移 186（DROP 旧 OKR 表）已经把它连同 goals 一起 DROP TABLE CASCADE 了；
--    迁移 185 同时把 tasks.project_id 的外键约束单独删掉（列保留，变成应用层保证的裸 uuid）。
--    所以当前库里根本没有 projects 表——不是"零读方"，是表已经不存在。本迁移把它重新建出来。
--
-- 本迁移：
--   ① 重建 projects 表（补回 000_base 原始列 + 接力棒/OKR 需要的新列），
--      并把 tasks.project_id 的外键重新接上（NOT VALID + best-effort VALIDATE，防止历史脏数据挡迁移）。
--   ② okr_projects → projects 原样搬家（同 id，保持 payload.project_ref / kr 链接不用改）；
--      okr_projects 表本身保留不删、不改结构（28 个读方的退役是棒4 的工作）。
--   ③ 历史 task_type='project' 根任务 → projects 行：子任务若已声明 payload.project_ref 指向
--      已存在的 projects 行就复用该 id，否则以根任务自身 id 新建一行；然后把整条链的 tasks.project_id
--      回填为这个 projects.id，根任务 payload 打上 migrated_to_project 标记（根任务本身保留，不删）。
--
-- 幂等：全部用 ON CONFLICT DO NOTHING / IF NOT EXISTS / project_id IS DISTINCT FROM 判断，可安全重放。
BEGIN;

-- ① 重建 projects 表（列集 = 000_base 原始列 + 本次新增列）
CREATE TABLE IF NOT EXISTS projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid,
    parent_id uuid REFERENCES projects(id),
    name character varying(255) NOT NULL,
    repo_path character varying(500),
    description text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    metadata jsonb,
    status character varying(50) DEFAULT 'active',
    area_id uuid REFERENCES areas(id),
    kr_id uuid REFERENCES key_results(id) ON DELETE SET NULL,
    brief jsonb NOT NULL DEFAULT '{}',
    owner_role varchar(100),
    start_date date,
    end_date date,
    notion_props jsonb NOT NULL DEFAULT '{}',
    custom_props jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_projects_kr_id ON projects(kr_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_area_id ON projects(area_id);
COMMENT ON TABLE projects IS 'GTD Project 真身（决策 ee4842a6/3feeae3e）：tasks.project_id 挂在它下面，接力棒链根 = projects 行。186 曾整表 DROP，497 重建。';
COMMENT ON COLUMN projects.brief IS '项目简报（棒2 填充协议，本迁移只建列）。';
COMMENT ON COLUMN projects.notion_props IS '含 notion_id / project_digest / project_db（接力棒 Notion 投影指纹，挪自旧 tasks.notion_props.project_digest）。';

-- tasks.project_id 外键重新接上（185 曾删掉；历史数据可能有脏值，NOT VALID 不阻断迁移）。
-- 验证结果不静默吞：用 session config 传给下面的 schema_version.description，落库可查
-- （不只是 RAISE WARNING 进服务端日志——主理人 09-30 要求验证失败要留痕）。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_project_id_fkey'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE tasks VALIDATE CONSTRAINT tasks_project_id_fkey;
    PERFORM set_config('cecelia.mig497_fk_note', 'tasks_project_id_fkey validated OK', false);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('cecelia.mig497_fk_note', 'tasks_project_id_fkey VALIDATE FAILED（历史脏数据未清，FK 仍是 NOT VALID）: ' || SQLERRM, false);
    RAISE WARNING 'tasks_project_id_fkey 验证部分失败（历史脏数据，不阻断迁移）：%', SQLERRM;
  END;
END $$;

-- ② okr_projects → projects 原样搬家（title→name；description 现已同时存在于两表）
INSERT INTO projects (id, name, description, status, area_id, kr_id, owner_role, start_date, end_date, metadata, custom_props, created_at, updated_at)
SELECT id, title, description, status, area_id, kr_id, owner_role, start_date, end_date, metadata, custom_props, created_at, updated_at
  FROM okr_projects
 ON CONFLICT (id) DO NOTHING;

-- ③ 历史 task_type='project' 根 → projects 行 + tasks.project_id 回填
DO $$
DECLARE
  r RECORD;
  pid uuid;
  ref uuid;
  st text;
BEGIN
  FOR r IN
    SELECT id, title, description, status, goal_id
      FROM tasks WHERE task_type = 'project'
  LOOP
    ref := NULL;
    SELECT NULLIF(t.payload->>'project_ref', '')::uuid INTO ref
      FROM tasks t
     WHERE (t.id = r.id OR t.parent_task_id = r.id)
       AND t.payload ? 'project_ref'
       AND t.payload->>'project_ref' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     LIMIT 1;

    IF ref IS NOT NULL AND EXISTS (SELECT 1 FROM projects WHERE id = ref) THEN
      pid := ref;
    ELSE
      st := CASE r.status
              WHEN 'queued' THEN 'planning'
              WHEN 'pending' THEN 'planning'
              WHEN 'in_progress' THEN 'active'
              WHEN 'completed' THEN 'completed'
              WHEN 'cancelled' THEN 'cancelled'
              WHEN 'canceled' THEN 'cancelled'
              ELSE 'active'
            END;
      INSERT INTO projects (id, name, description, status, kr_id)
      VALUES (
        r.id, COALESCE(r.title, r.id::text), r.description, st,
        CASE WHEN r.goal_id IS NOT NULL AND EXISTS (SELECT 1 FROM key_results WHERE id = r.goal_id) THEN r.goal_id ELSE NULL END
      )
      ON CONFLICT (id) DO NOTHING;
      pid := r.id;
    END IF;

    UPDATE tasks SET project_id = pid
     WHERE (id = r.id OR parent_task_id = r.id) AND project_id IS DISTINCT FROM pid;

    UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('migrated_to_project', pid::text)
     WHERE id = r.id AND (payload->>'migrated_to_project') IS DISTINCT FROM pid::text;
  END LOOP;
END $$;

INSERT INTO schema_version (version, description)
VALUES ('497', 'Projects 真身表重建（186 曾 DROP）：projects 表 + tasks.project_id FK 重接 + okr_projects 搬家 + 历史 task_type=project 根回填（棒1，决策 ee4842a6/3feeae3e）｜FK 校验: '
  || COALESCE(current_setting('cecelia.mig497_fk_note', true), 'tasks_project_id_fkey validated OK'))
ON CONFLICT (version) DO NOTHING;

COMMIT;
