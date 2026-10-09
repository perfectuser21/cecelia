-- 482_backbone_activity_contracts.sql
-- 主干活动契约 git→Brain→Notion（决策 0834e2fb：契约真身在 git，Brain/Notion 为自动同步的只读副本；
-- 决策 92f6226b：获客主干活动以 8 个执行活动为准，backbone_version 3.0）。任务 2fdd5f12。
--
--   一、journey_steps（视图 backbone_activities）加契约副本列：capability_key/activity_key 定位，
--       contract = zenithjoy-workspace product-map/contracts/<能力>.yaml 里该活动原文（jsonb），
--       contract_sha256 = 仓库 product-map/generated/contracts.json 的活动哈希（对账键），
--       contract_source = 钉在 commit 的正本链接；notion_digest 为统一推送引擎记账列（451 漏了本表）。
--       写入方只有 activity-contract-sync.js（scheduler job backbone-contract-sync），人不在 Brain/Notion 改契约。
--   二、获客 journey afa6abca：v2.0 四个客户承诺步骤（09-26 psql 手工落，决策 60da58cf）挪号 200+ 并 deprecated，
--       种 8 个 v3.0 主干活动；承诺并入 promise 列：可用小号数可见→预检、关键词视频清单→判定（发现+判定兑现，
--       挂在最后兑现的判定上）、Lead 表进人→评分、私信触达五态→触达。
--       7 个 stage:* 格子从承诺步骤改挂到同名活动（一格一活动），补 stage:outreach 格子。
--   三、notion_projection_map：Notion「Backbone Activities」c213e387（09-27 建，空表）登记为 journey_steps 镜子；
--       453 的 unmapped:backbone_activities 占位行归档。

-- 一、契约副本列
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS capability_key text;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS activity_key text;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS contract jsonb;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS contract_sha256 text;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS contract_source text;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS notion_digest text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_journey_steps_activity ON journey_steps (journey_id, activity_key) WHERE activity_key IS NOT NULL;

-- 二、获客 v3.0 八活动
DO $$
DECLARE
  j uuid := 'afa6abca-53c0-4815-8594-b7fb81ca547f';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journeys WHERE id = j) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM journey_steps WHERE journey_id = j AND activity_key IS NOT NULL) THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE _promises ON COMMIT DROP AS
    SELECT step_number, promise FROM journey_steps
     WHERE journey_id = j AND backbone_version = '2.0' AND step_number < 100;

  UPDATE journey_steps
     SET step_number = step_number + 200, status = 'deprecated', updated_at = NOW()
   WHERE journey_id = j AND backbone_version = '2.0' AND step_number < 100;

  INSERT INTO journey_steps (journey_id, name, step_number, status, backbone_version, capability_key, activity_key, promise) VALUES
    (j, '预检', 1, 'planned', '3.0', 'keyword_acquisition', 'preflight', (SELECT promise FROM _promises WHERE step_number = 1)),
    (j, '发现', 2, 'planned', '3.0', 'keyword_acquisition', 'discovery', NULL),
    (j, '判定', 3, 'planned', '3.0', 'keyword_acquisition', 'qualification', (SELECT promise FROM _promises WHERE step_number = 2)),
    (j, '采集', 4, 'planned', '3.0', 'keyword_acquisition', 'collection', NULL),
    (j, '评分', 5, 'planned', '3.0', 'keyword_acquisition', 'scoring', (SELECT promise FROM _promises WHERE step_number = 3)),
    (j, '配送', 6, 'planned', '3.0', 'keyword_acquisition', 'delivery', NULL),
    (j, '触达', 7, 'planned', '3.0', 'keyword_acquisition', 'outreach', (SELECT promise FROM _promises WHERE step_number = 4)),
    (j, '归位', 8, 'planned', '3.0', 'keyword_acquisition', 'cleanup', NULL);

  UPDATE journey_step_links l
     SET step_id = s.id, step_order = s.step_number
    FROM journey_steps s
   WHERE l.journey_id = j AND s.journey_id = j AND s.activity_key IS NOT NULL
     AND l.cell_key = 'stage:' || s.activity_key;

  INSERT INTO journey_step_links (journey_id, step_id, step_order, status, cell_kind, cell_key, cell_status)
  SELECT j, s.id, s.step_number, 'planned', 'element', 'stage:outreach', 'gray'
    FROM journey_steps s
   WHERE s.journey_id = j AND s.activity_key = 'outreach'
  ON CONFLICT DO NOTHING;
END $$;

-- 三、映射表
UPDATE notion_projection_map
   SET status = 'archived', notes = COALESCE(notes, '') || '；482 起由 Backbone Activities c213e387 承接'
 WHERE notion_db_id = 'unmapped:backbone_activities';

INSERT INTO notion_projection_map
  (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes)
VALUES
  ('c213e387-b2ae-45a4-98c0-4a66fe3408be', 'Backbone Activities', 'mirror', 'journey_steps', 'push',
   'activity-contract-sync.pushBackboneActivities', 'active', 'system',
   '主干活动契约只读镜子（决策 0834e2fb）：只推带契约的行；正本在 zenithjoy-workspace product-map/contracts，改契约走 git')
ON CONFLICT DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('482', '主干活动契约副本列 + 获客 v3.0 八活动（承诺并入、格子改挂、补 stage:outreach）+ Backbone Activities 镜子登记');
