-- Migration 496: 价值流建模⑤——探针挂点 target + 格子扩到 step/enabler 级 + golden_path* 退役标注
-- 决策 3e867cad（第 11/13 张表与收尾）、f425e3fd（词表两根轴）；任务 741cdf5a。
--
-- 一、step_probes 挂点：加 target_type（activity|step|enabler）+ target_id。
--     既有探针回填 target_type='activity'、target_id=所绑格子的 step_id（= journey_steps.id，活动）；
--     journey_step_link_id 保留（活动格照绑，翻色仍活动级——state-resolver 未改）。
--     coll_rescan_rate（兜底重搜触发率）本质是「归位」这一步的过程指标，改挂 step keyword_acquisition.collection.return_to_results。
-- 二、journey_step_links 三级格子：cell_level（默认 activity）/ step_id_ref → steps / enabler_id → enablers。
--     按 steps 表给智能获客价值流（afa6abca）每个 step 生成一格 step:<key>（gray，挂在所属活动 journey_steps.id 上）；
--     按 enabler_calls 给每个被调用的 enabler 生成一格 enabler:<key>（挂在最早调用它的活动上）。
--     ON CONFLICT DO NOTHING：重放不覆盖已翻的颜色。
-- 三、Notion 投影：无新表/视图，只是新列，notion_projection_map 不动（照 #5717 做法：有 notion_id 的新关系才登记）。
-- 四、golden_path / golden_paths / golden_path_contract_versions：仓库里仍有 74 处活引用（harness-judge / handoff /
--     acceptance / abilities / golden-paths 路由等），本迁移不 RENAME 不 DROP、一行不动，只挂退役注释；真正退役等引用清零。
BEGIN;

-- 一、step_probes 挂点
ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS target_type text;
ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS target_id uuid;
ALTER TABLE step_probes DROP CONSTRAINT IF EXISTS step_probes_target_type_check;
ALTER TABLE step_probes ADD CONSTRAINT step_probes_target_type_check
  CHECK (target_type IS NULL OR target_type IN ('activity', 'step', 'enabler'));
CREATE INDEX IF NOT EXISTS idx_step_probes_target ON step_probes (target_type, target_id) WHERE target_id IS NOT NULL;

COMMENT ON COLUMN step_probes.target_type IS
  '探针挂点类型：activity → journey_steps.id / step → steps.id / enabler → enablers.id。缺省由 journey_cell 决定（activity）。';
COMMENT ON COLUMN step_probes.target_id IS '探针挂点 id（按 target_type 解释）。journey_step_link_id 仍是活动格绑定，翻色按活动级。';

UPDATE step_probes sp
   SET target_type = 'activity', target_id = jsl.step_id
  FROM journey_step_links jsl
 WHERE jsl.id = sp.journey_step_link_id
   AND sp.target_type IS NULL;

UPDATE step_probes sp
   SET target_type = 'step', target_id = s.id
  FROM steps s
 WHERE s.key = 'keyword_acquisition.collection.return_to_results'
   AND sp.probe_key = 'coll_rescan_rate'
   AND (sp.target_type IS DISTINCT FROM 'step' OR sp.target_id IS DISTINCT FROM s.id);

-- 二、journey_step_links 三级格子
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS cell_level text NOT NULL DEFAULT 'activity';
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS step_id_ref uuid NULL REFERENCES steps(id) ON DELETE CASCADE;
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS enabler_id uuid NULL REFERENCES enablers(id) ON DELETE CASCADE;
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS journey_step_links_cell_level_check;
ALTER TABLE journey_step_links ADD CONSTRAINT journey_step_links_cell_level_check
  CHECK (cell_level IN ('activity', 'step', 'enabler'));
CREATE INDEX IF NOT EXISTS idx_jsl_step_id_ref ON journey_step_links (step_id_ref) WHERE step_id_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jsl_enabler_id ON journey_step_links (enabler_id) WHERE enabler_id IS NOT NULL;

COMMENT ON COLUMN journey_step_links.cell_level IS
  '格子层级：activity（既有 stage:<key> 格，翻色单位）/ step（step:<key>，step_id_ref → steps）/ enabler（enabler:<key>，enabler_id → enablers）。step_id 始终是所属活动。';
COMMENT ON COLUMN journey_step_links.step_id_ref IS 'cell_level=step 时指向 steps.id；活动格为 NULL。';
COMMENT ON COLUMN journey_step_links.enabler_id IS 'cell_level=enabler 时指向 enablers.id；活动格为 NULL。';

-- step 级格子：智能获客价值流下每个 step 一格，挂在所属活动上
INSERT INTO journey_step_links
  (journey_id, step_id, step_order, cell_kind, cell_key, cell_status, status, notion_synced_at, cell_level, step_id_ref)
SELECT js.journey_id, js.id, COALESCE(js.step_number, 0) * 100 + s.step_order, 'element', 'step:' || s.key, 'gray', 'planned', NOW(), 'step', s.id
  FROM steps s
  JOIN journey_steps js ON js.id = s.activity_id
 WHERE js.journey_id = 'afa6abca-53c0-4815-8594-b7fb81ca547f'
   AND s.active = true
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- enabler 级格子：每个被活动调用的 enabler 一格，挂在最早调用它的活动上
INSERT INTO journey_step_links
  (journey_id, step_id, step_order, cell_kind, cell_key, cell_status, status, notion_synced_at, cell_level, enabler_id)
SELECT DISTINCT ON (e.id) js.journey_id, js.id, COALESCE(js.step_number, 0) * 100 + 99, 'element', 'enabler:' || e.key, 'gray', 'planned', NOW(), 'enabler', e.id
  FROM enablers e
  JOIN enabler_calls ec ON ec.enabler_id = e.id AND ec.caller_type = 'activity'
  JOIN journey_steps js ON js.id = ec.caller_id
 WHERE js.journey_id = 'afa6abca-53c0-4815-8594-b7fb81ca547f'
   AND e.active = true
 ORDER BY e.id, js.step_number ASC NULLS LAST, js.id
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING;

-- 四、golden_path* 退役标注（表可能不存在——只在存在时挂注释）
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['golden_path', 'golden_paths', 'golden_path_contract_versions'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('COMMENT ON TABLE %I IS %L', t,
        '【退役计划】价值流建模⑤（决策 3e867cad）：由 journeys/journey_steps/steps/enablers + journey_step_links 三级格子接替；'
        || '仓库仍有活引用，引用清零前不 RENAME 不 DROP，行数原样保留。');
    END IF;
  END LOOP;
END $$;

INSERT INTO schema_version (version, description)
VALUES ('496', '价值流建模⑤：step_probes 挂点 target_type/target_id（回填 activity，coll_rescan_rate 挂 step）+ journey_step_links 三级格子（cell_level/step_id_ref/enabler_id，按 steps/enablers 生成 step:/enabler: 格）+ golden_path* 退役标注')
ON CONFLICT (version) DO NOTHING;

COMMIT;
