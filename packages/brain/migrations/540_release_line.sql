-- 540: 发布线（决策 de6dff5d 五块模型：树+仓库+账本+裁判+发布线，第 3 步）
-- 构建层与版本层分开：
--   构建 = activity_definition_versions（每个 commit 一行，部署证据，不动、不加列，下游 SELECT * 读者零影响）
--   版本 = activity_versions（按内容去重：payload 去掉 implementation_bindings 后的 md5；内容没变就不出新版本）
--   activity_version_builds = 构建 → 版本映射（只追加）
--   activity_release_state = 每个 Activity 一行的生产指针（独立表，不给 activities 加列）
--   activity_release_events = 晋级/退回/冷启动/影子判定记录（只追加）
--   workflow_production_recipes = 流程生产配方（每格填该 Activity 的生产版，只追加，最新一行即当前）
-- current_definition_version_id 语义不变（仍是最新构建），已有构建行、release、运行绑定一律不改。
-- 初始生产版 = 今天 current_definition_version_id 所在构建对应的内容版本 → 执行端今天拿到的定义不变。
BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS activity_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id     uuid NOT NULL REFERENCES activities(id),
  content_md5     text NOT NULL CHECK (content_md5 ~ '^[0-9a-f]{32}$'),
  version_no      integer NOT NULL CHECK (version_no >= 1),
  first_build_id  uuid NOT NULL REFERENCES activity_definition_versions(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, content_md5),
  UNIQUE (activity_id, version_no),
  UNIQUE (activity_id, id)
);
COMMENT ON TABLE activity_versions IS '发布线·版本（只追加）：同一 Activity 按内容去重，内容 = 构建 payload 去掉 implementation_bindings（决策 de6dff5d）';
COMMENT ON COLUMN activity_versions.content_md5 IS 'md5((payload - ''implementation_bindings'')::text)，SQL 端计算，迁移与运行时同一表达式';

CREATE TABLE IF NOT EXISTS activity_version_builds (
  build_id             uuid PRIMARY KEY REFERENCES activity_definition_versions(id),
  activity_id          uuid NOT NULL,
  activity_version_id  uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (activity_id, activity_version_id) REFERENCES activity_versions(activity_id, id)
);
CREATE INDEX IF NOT EXISTS idx_activity_version_builds_version ON activity_version_builds (activity_version_id);
COMMENT ON TABLE activity_version_builds IS '发布线·构建→版本映射（只追加）';

CREATE TABLE IF NOT EXISTS activity_release_state (
  activity_id            uuid PRIMARY KEY REFERENCES activities(id),
  production_version_id  uuid NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (activity_id, production_version_id) REFERENCES activity_versions(activity_id, id)
);
COMMENT ON TABLE activity_release_state IS '发布线·生产指针：每个 Activity 当前生产版。把关开关关闭期间只是账面指针，不代表执行端实际跑的版本';

CREATE TABLE IF NOT EXISTS activity_release_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  activity_id      uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('initial', 'promote', 'group_promote', 'bootstrap', 'promote_rejected',
                     'promote_would_reject', 'candidate_held', 'rollback_auto', 'rollback_manual', 'rollback_advisory', 'rollback_unavailable')),
  group_id         uuid,
  actor            text NOT NULL,
  reason           text NOT NULL,
  from_version_id  uuid REFERENCES activity_versions(id),
  to_version_id    uuid REFERENCES activity_versions(id),
  judgment_ids     bigint[] NOT NULL DEFAULT '{}',
  compare_result   jsonb,
  gate             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_release_events_activity ON activity_release_events (activity_id, id DESC);
-- 「有候选待晋级」「影子模式下会被拒」按 (Activity, 候选版本) 只记一次
CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_release_events_candidate_notice
  ON activity_release_events (activity_id, kind, to_version_id) WHERE kind IN ('candidate_held', 'promote_would_reject');
COMMENT ON TABLE activity_release_events IS '发布线·晋级/退回记录（只追加）';

CREATE TABLE IF NOT EXISTS workflow_production_recipes (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id     uuid NOT NULL REFERENCES workflows(id),
  recipe          jsonb NOT NULL CHECK (jsonb_typeof(recipe) = 'array'),
  recipe_md5      text NOT NULL CHECK (recipe_md5 ~ '^[0-9a-f]{32}$'),
  cause           text NOT NULL,
  cause_event_id  bigint REFERENCES activity_release_events(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflow_production_recipes_workflow ON workflow_production_recipes (workflow_id, id DESC);
COMMENT ON TABLE workflow_production_recipes IS '发布线·流程生产配方（只追加）：[{slot_key,sequence_no,activity_id,activity_version_id,content_md5}]，每个流程最新一行即当前';

CREATE OR REPLACE FUNCTION release_line_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '发布线记录只追加：禁止 UPDATE/DELETE %', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS activity_versions_append_only ON activity_versions;
CREATE TRIGGER activity_versions_append_only BEFORE UPDATE OR DELETE ON activity_versions
  FOR EACH ROW EXECUTE FUNCTION release_line_append_only();
DROP TRIGGER IF EXISTS activity_version_builds_append_only ON activity_version_builds;
CREATE TRIGGER activity_version_builds_append_only BEFORE UPDATE OR DELETE ON activity_version_builds
  FOR EACH ROW EXECUTE FUNCTION release_line_append_only();
DROP TRIGGER IF EXISTS activity_release_events_append_only ON activity_release_events;
CREATE TRIGGER activity_release_events_append_only BEFORE UPDATE OR DELETE ON activity_release_events
  FOR EACH ROW EXECUTE FUNCTION release_line_append_only();
DROP TRIGGER IF EXISTS workflow_production_recipes_append_only ON workflow_production_recipes;
CREATE TRIGGER workflow_production_recipes_append_only BEFORE UPDATE OR DELETE ON workflow_production_recipes
  FOR EACH ROW EXECUTE FUNCTION release_line_append_only();

-- 裁判表：晋级门的收敛判定也作为一条裁判落库（538 的 CHECK 是匿名约束，按定义找名字再换）
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'activity_judgments'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%trigger_kind%' LOOP
    EXECUTE format('ALTER TABLE activity_judgments DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE activity_judgments ADD CONSTRAINT activity_judgments_trigger_kind_check
  CHECK (trigger_kind IN ('auto', 'manual', 'promotion_gate'));

-- ── 现有数据：初始生产版 = 今天正在用的版本 ─────────────────────────────
-- 1) 每个 Activity 的每种内容一行版本，按首次出现时间编号（同时间按 id 文本裁决）；consumer_evidence 定义不进发布线
CREATE TEMP TABLE release_line_builds ON COMMIT DROP AS
  SELECT id, activity_id, created_at, md5((payload - 'implementation_bindings')::text) AS content_md5
    FROM activity_definition_versions
   WHERE COALESCE(payload->>'definition_scope', '') <> 'consumer_evidence';

INSERT INTO activity_versions (activity_id, content_md5, version_no, first_build_id, created_at)
SELECT activity_id, content_md5,
       row_number() OVER (PARTITION BY activity_id ORDER BY created_at, id::text),
       id, created_at
  FROM (SELECT DISTINCT ON (activity_id, content_md5) id, activity_id, content_md5, created_at
          FROM release_line_builds ORDER BY activity_id, content_md5, created_at, id::text) firsts
ON CONFLICT (activity_id, content_md5) DO NOTHING;

INSERT INTO activity_version_builds (build_id, activity_id, activity_version_id, created_at)
SELECT b.id, b.activity_id, v.id, b.created_at
  FROM release_line_builds b JOIN activity_versions v ON v.activity_id = b.activity_id AND v.content_md5 = b.content_md5
ON CONFLICT (build_id) DO NOTHING;

-- 2) 生产指针 = current_definition_version_id 所在构建的内容版本；current 为空的 Activity 不建指针
INSERT INTO activity_release_state (activity_id, production_version_id)
SELECT a.id, m.activity_version_id
  FROM activities a JOIN activity_version_builds m ON m.build_id = a.current_definition_version_id
ON CONFLICT (activity_id) DO NOTHING;

-- 3) 每个指针一条 initial 事件
INSERT INTO activity_release_events (activity_id, kind, actor, reason, to_version_id, gate)
SELECT s.activity_id, 'initial', 'migration_540', 'initial_migration_current_definition', s.production_version_id,
       jsonb_build_object('converged', false, 'source', 'current_definition_version_id')
  FROM activity_release_state s;

-- 4) 每个流程按 current 的 payload.activities 写初始配方：每格填该 Activity 的生产指针；
--    指针与该格冻结的构建内容不一致的，记 NOTICE（迁移日志），不静默
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
    FROM workflows w JOIN workflow_definition_versions v ON v.id = w.current_definition_version_id
         CROSS JOIN LATERAL jsonb_array_elements(v.payload->'activities') e
         JOIN activity_version_builds m ON m.build_id = (e->>'activity_version_id')::uuid
         LEFT JOIN activity_release_state s ON s.activity_id = (e->>'activity_id')::uuid
   WHERE COALESCE(v.payload->>'definition_scope', '') <> 'consumer_evidence'
     AND s.production_version_id IS DISTINCT FROM m.activity_version_id;
  IF n > 0 THEN RAISE NOTICE '540: % 个流程格冻结构建内容与生产指针不一致（配方按生产指针填）', n; END IF;
END $$;

INSERT INTO workflow_production_recipes (workflow_id, recipe, recipe_md5, cause)
SELECT r.workflow_id, r.recipe, md5(r.recipe::text), 'initial_migration'
  FROM (
    SELECT w.id AS workflow_id,
           COALESCE(jsonb_agg(jsonb_build_object(
             'slot_key', e->>'slot_key',
             'sequence_no', (e->>'sequence_no')::int,
             'activity_id', e->>'activity_id',
             'activity_version_id', COALESCE(s.production_version_id, m.activity_version_id),
             'content_md5', av.content_md5)
             ORDER BY (e->>'sequence_no')::int, e->>'slot_key'), '[]'::jsonb) AS recipe
      FROM workflows w JOIN workflow_definition_versions v ON v.id = w.current_definition_version_id
           CROSS JOIN LATERAL jsonb_array_elements(v.payload->'activities') e
           LEFT JOIN activity_version_builds m ON m.build_id = (e->>'activity_version_id')::uuid
           LEFT JOIN activity_release_state s ON s.activity_id = (e->>'activity_id')::uuid
           LEFT JOIN activity_versions av ON av.id = COALESCE(s.production_version_id, m.activity_version_id)
     WHERE COALESCE(v.payload->>'definition_scope', '') <> 'consumer_evidence'
     GROUP BY w.id
  ) r;

INSERT INTO schema_version (version, description)
VALUES ('540', '发布线：内容版本 activity_versions、构建映射、生产指针、晋级/退回事件、流程生产配方')
ON CONFLICT (version) DO NOTHING;

COMMIT;
