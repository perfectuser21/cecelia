-- Migration 494: 价值流建模③（决策 3e867cad 第 4-5 张表 + 752b7166；词表 f425e3fd；任务 ce41cd59）
--
-- 词表：Value Stream（客户买的产品线）→ Capability（客户能指着配置的功能，= 有父的 journey）→ Workflow（能力 × 渠道/形态，能跑）
--       → Backbone Activity（阶段，由一个执行体负责）→ Step。
-- 此前 "workflow" 只是 step_probes 上的字符串标签，"capability" 只是 journey_steps 上的标签；两层都不是表，
-- 建不出"一个能力下多条渠道实现"的关系。本迁移把 Workflow 建成真表，并让 8 个骨干活动挂到它。
--
-- ① workflows：capability_id 必须指向有父的 journey（kind=capability，493 的生成列）。CHECK 不能子查询，用触发器守卫。
-- ② journey_steps（backbone_activities 视图底表）加 workflow_id / executor_kind / enabler_id：
--    不删 journey_id（地图、探针、回执全靠它），workflow_id 先并行存在；executor_kind 是"谁来干"这根轴（code|agent|human）；
--    enabler_id 表示这一格是 Call Activity（格子里没自己的逻辑，只是调用某个 Enabler，如 预检=拿锁+验账号、收尾=放锁+回桌面）。
-- ③ backbone_activities 视图重建，带出 capability_key / activity_key 与上面三列。
-- ④ ops_workflows.workflow_id：n8n 画布 / cron 脚本降为 Workflow 的运行时实现（决策 752b7166 覆盖 09-07 "真 workflow = n8n 业务流程"）。
-- ⑤ 回填（幂等，只在价值流「客户智能获客路径」存在时生效）：
--    capability 关键词获客 / 对标获客（父 = afa6abca）；workflow 抖音·关键词获客 / 抖音·对标获客；
--    backbone_version 3.0 的 8 个 activity 挂抖音·关键词获客；executor_kind：判定/评分=agent，其余=code；
--    enabler device_lock / account_selfcheck 种子；预检、收尾 enabler_id=device_lock，enabler_calls 记 预检→{device_lock,account_selfcheck}、收尾→device_lock。
--    对标获客与关键词获客共用 7 个活动、只有"发现"不同，本次不复制活动行（共用关系留给 enabler_calls / 后续）。
BEGIN;

-- ① workflows
CREATE TABLE IF NOT EXISTS workflows (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  capability_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  channel text NOT NULL,
  form text,
  version text NOT NULL DEFAULT '1.0',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflows_status_check CHECK (status IN ('active', 'paused', 'retired'))
);
CREATE INDEX IF NOT EXISTS idx_workflows_capability ON workflows (capability_id);
COMMENT ON TABLE workflows IS 'Workflow = 一个 Capability 在某渠道/形态上的可执行链条（词表 f425e3fd；决策 3e867cad / 752b7166）。capability_id 必须是有父的 journey。';
COMMENT ON COLUMN workflows.channel IS '渠道：douyin / xiaohongshu / kuaishou / wechat …';
COMMENT ON COLUMN workflows.form IS '形态：android_rpa / web / api …（可空）';

CREATE OR REPLACE FUNCTION workflows_capability_guard() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journeys WHERE id = NEW.capability_id AND parent_journey_id IS NOT NULL) THEN
    RAISE EXCEPTION 'workflows.capability_id % must reference a capability (journey with parent_journey_id); decision 3e867cad', NEW.capability_id;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_workflows_capability_guard ON workflows;
CREATE TRIGGER trg_workflows_capability_guard BEFORE INSERT OR UPDATE OF capability_id ON workflows
  FOR EACH ROW EXECUTE FUNCTION workflows_capability_guard();

-- ② journey_steps 三列
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS workflow_id uuid NULL REFERENCES workflows(id) ON DELETE SET NULL;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS executor_kind text NULL;
ALTER TABLE journey_steps DROP CONSTRAINT IF EXISTS journey_steps_executor_kind_check;
ALTER TABLE journey_steps ADD CONSTRAINT journey_steps_executor_kind_check
  CHECK (executor_kind IS NULL OR executor_kind IN ('code', 'agent', 'human'));
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS enabler_id uuid NULL REFERENCES enablers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_journey_steps_workflow ON journey_steps (workflow_id);
COMMENT ON COLUMN journey_steps.workflow_id IS '所属 Workflow（决策 3e867cad）；journey_id 保留，两者并行';
COMMENT ON COLUMN journey_steps.executor_kind IS '谁来干：code | agent | human（执行体轴，与是不是 Enabler 无关）';
COMMENT ON COLUMN journey_steps.enabler_id IS '非空 = 这一格是 Call Activity，只调用该 Enabler（如 预检=设备锁+账号自证）';

-- ③ backbone_activities 视图重建（列集变了，DROP+CREATE；只动 current_schema，照 493 的做法）
DO $$
DECLARE kind_ "char";
BEGIN
  SELECT c.relkind INTO kind_ FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'backbone_activities' AND n.nspname = current_schema();
  IF kind_ = 'v' THEN EXECUTE format('DROP VIEW %I.backbone_activities', current_schema()); END IF;
END $$;
CREATE VIEW backbone_activities AS SELECT id, notion_id, journey_id, name, description, step_number, status, notion_synced_at, created_at, updated_at, promise, backbone_version, capability_key, activity_key, workflow_id, executor_kind, enabler_id FROM journey_steps;
COMMENT ON VIEW backbone_activities IS 'Backbone Activity = journey_steps（词表 f425e3fd）；494 起带 workflow_id / executor_kind / enabler_id';

-- ④ ops_workflows → workflows
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS workflow_id uuid NULL REFERENCES workflows(id) ON DELETE SET NULL;
COMMENT ON COLUMN ops_workflows.workflow_id IS 'n8n 画布 / cron 脚本是哪条 Workflow 的运行时实现（决策 752b7166）；本迁移不回填';

-- ⑤ 回填：智能获客（价值流 afa6abca 存在才做，重放幂等）
INSERT INTO journeys (id, name, parent_journey_id, description, journey_type, maturity, status, area_id)
SELECT 'a1000000-0000-4000-8000-000000000001', '关键词获客', p.id,
       '按客户配置的关键词搜索候选视频、判定、采评论出线索（Capability，SAFe 义）', p.journey_type, p.maturity, p.status, p.area_id
  FROM journeys p
 WHERE p.id = 'afa6abca-53c0-4815-8594-b7fb81ca547f'
   AND NOT EXISTS (SELECT 1 FROM journeys x WHERE x.parent_journey_id = p.id AND x.name = '关键词获客')
ON CONFLICT (id) DO NOTHING;
INSERT INTO journeys (id, name, parent_journey_id, description, journey_type, maturity, status, area_id)
SELECT 'a1000000-0000-4000-8000-000000000002', '对标获客', p.id,
       '按客户配置的对标账号主页抽视频、判定、采评论出线索（Capability，SAFe 义；决策 7f842d12）', p.journey_type, p.maturity, p.status, p.area_id
  FROM journeys p
 WHERE p.id = 'afa6abca-53c0-4815-8594-b7fb81ca547f'
   AND NOT EXISTS (SELECT 1 FROM journeys x WHERE x.parent_journey_id = p.id AND x.name = '对标获客')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflows (id, capability_id, key, name, channel, form, version, status)
SELECT 'b1000000-0000-4000-8000-000000000001', c.id, 'douyin_keyword_leadgen', '抖音·关键词获客', 'douyin', 'android_rpa', '1.0', 'active'
  FROM journeys c WHERE c.parent_journey_id = 'afa6abca-53c0-4815-8594-b7fb81ca547f' AND c.name = '关键词获客'
ON CONFLICT (key) DO NOTHING;
INSERT INTO workflows (id, capability_id, key, name, channel, form, version, status)
SELECT 'b1000000-0000-4000-8000-000000000002', c.id, 'douyin_benchmark_leadgen', '抖音·对标获客', 'douyin', 'android_rpa', '1.0', 'active'
  FROM journeys c WHERE c.parent_journey_id = 'afa6abca-53c0-4815-8594-b7fb81ca547f' AND c.name = '对标获客'
ON CONFLICT (key) DO NOTHING;

UPDATE journey_steps js SET workflow_id = w.id
  FROM workflows w
 WHERE w.key = 'douyin_keyword_leadgen'
   AND js.journey_id = 'afa6abca-53c0-4815-8594-b7fb81ca547f'
   AND js.backbone_version = '3.0' AND js.capability_key = 'keyword_acquisition'
   AND js.workflow_id IS NULL;

UPDATE journey_steps SET executor_kind = CASE activity_key WHEN 'qualification' THEN 'agent' WHEN 'scoring' THEN 'agent' ELSE 'code' END
 WHERE journey_id = 'afa6abca-53c0-4815-8594-b7fb81ca547f'
   AND backbone_version = '3.0' AND capability_key = 'keyword_acquisition'
   AND executor_kind IS NULL;

INSERT INTO enablers (key, name, kind, impl_ref, owner, description) VALUES
  ('device_lock', '设备锁', 'code',
   'zenithjoy-workspace:services/phone-adb-controller/douyin-phone-adb#lock-acquire,lock-refresh,lock-release',
   'line02', '同一台手机同一时刻只允许一条 run 驱动：预检拿锁、长活动续期、收尾放锁；被关键词获客/对标获客/触达共用。'),
  ('account_selfcheck', '账号自证', 'code',
   'zenithjoy-workspace:services/phone-adb-controller/douyin-phone-adb#account-current',
   'line02', '开工前读「我」页抖音号核对是本 run 该用的账号，防串号；预检调用。')
ON CONFLICT (key) DO NOTHING;

UPDATE journey_steps js SET enabler_id = e.id
  FROM enablers e
 WHERE e.key = 'device_lock'
   AND js.journey_id = 'afa6abca-53c0-4815-8594-b7fb81ca547f'
   AND js.backbone_version = '3.0' AND js.activity_key IN ('preflight', 'cleanup')
   AND js.enabler_id IS NULL;

INSERT INTO enabler_calls (caller_type, caller_id, enabler_id)
SELECT 'activity', js.id, e.id
  FROM journey_steps js
  JOIN enablers e ON (
        (js.activity_key = 'preflight' AND e.key IN ('device_lock', 'account_selfcheck'))
     OR (js.activity_key = 'cleanup' AND e.key = 'device_lock'))
 WHERE js.journey_id = 'afa6abca-53c0-4815-8594-b7fb81ca547f' AND js.backbone_version = '3.0'
ON CONFLICT (caller_type, caller_id, enabler_id) DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('494', '价值流建模③：workflows 表 + capability 守卫 + journey_steps.workflow_id/executor_kind/enabler_id + backbone_activities 视图新列 + ops_workflows.workflow_id + 智能获客回填')
ON CONFLICT (version) DO NOTHING;

COMMIT;
