-- Migration 478: 验证层三表接 Notion 投影（链 bf5088a3 棒4-2，任务 bf8d6ffb，决策 10a68212）
--
-- 探针表 step_probes（474）与判定回执 journey_assertion_receipts（374/475）只在 Brain Postgres，
-- 承诺地图格子 journey_step_links.cell_status 翻了色 Notion 也看不到（连接行只增不改、表无 updated_at）。
-- 本迁移只加记账列与触发器，不改任何业务列：
--   一、step_probes / journey_assertion_receipts 加 notion_id / notion_synced_at / notion_digest
--       （与 468 task_runs 逐字同约定：lib/notion-projection-engine.js pushRegisteredRows 的增量与去重依赖）。
--   二、回执表 append-only 触发器（374）改为：UPDATE 若除三记账列外一字未动 → 放行；其余 UPDATE/DELETE 照旧拒。
--       证据不可改的语义不变，只让投影引擎能回写「推到哪一页」。
--   三、journey_step_links 加 updated_at + 触发器：非记账列（去 notion_* 与 updated_at）有变化才抬；
--       引擎回写 notion_synced_at 不抬 updated_at，否则每轮 synced 抬一次 updated_at 又抬一次 = 自激重推。
--   四、notion_projection_map 登记「探针」「判定回执」两库（scripts/ops/create-probe-notion-dbs.js 在
--       「数据落脚总台账」页下建成，2026-09-27）。换库只改这两行（resolveDbId 只认 push+active）。

-- 一、记账列
ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS notion_id text;
ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS notion_synced_at timestamptz;
ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS notion_digest text;

ALTER TABLE journey_assertion_receipts ADD COLUMN IF NOT EXISTS notion_id text;
ALTER TABLE journey_assertion_receipts ADD COLUMN IF NOT EXISTS notion_synced_at timestamptz;
ALTER TABLE journey_assertion_receipts ADD COLUMN IF NOT EXISTS notion_digest text;

-- 二、append-only 触发器放行「仅记账列变化」的 UPDATE
CREATE OR REPLACE FUNCTION prevent_journey_assertion_receipt_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'notion_id' - 'notion_synced_at' - 'notion_digest')
       = (to_jsonb(OLD) - 'notion_id' - 'notion_synced_at' - 'notion_digest') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'journey_assertion_receipts is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- 三、journey_step_links.updated_at + 触发器
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION touch_journey_step_links_updated_at()
RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'notion_id' - 'notion_synced_at' - 'notion_digest' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'notion_id' - 'notion_synced_at' - 'notion_digest' - 'updated_at') THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_journey_step_links_updated_at ON journey_step_links;
CREATE TRIGGER trg_touch_journey_step_links_updated_at
  BEFORE UPDATE ON journey_step_links
  FOR EACH ROW EXECUTE FUNCTION touch_journey_step_links_updated_at();

COMMENT ON COLUMN journey_step_links.updated_at IS
  '非记账列最近变化时间（触发器维护；notion_* 回写不抬）。notion-push-sync 按 updated_at > notion_synced_at 增量重推格子。';

-- 四、注册表登记
INSERT INTO notion_projection_map
  (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes)
VALUES
  ('3e8c40c2-ba63-8182-954e-f9eda21d137e', '探针', 'mirror', 'step_probes', 'push',
   'notion-probe-projection.pushStepProbes', 'active', 'system',
   '验证层探针注册表投影（决策 10a68212）；库在「数据落脚总台账」页下，scripts/ops/create-probe-notion-dbs.js 幂等建/补列'),
  ('3e8c40c2-ba63-81d7-8c48-c70142b3f0bc', '判定回执', 'mirror', 'journey_assertion_receipts', 'push',
   'notion-probe-projection.pushProbeReceipts', 'active', 'system',
   '只投 executor_kind=business_probe_runner 行；harness 代码断言回执不投（决策 10a68212）')
ON CONFLICT DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('478', '验证层三表接 Notion 投影：step_probes/journey_assertion_receipts 记账列 + 回执触发器放行记账 UPDATE + journey_step_links.updated_at 触发器 + 探针/判定回执两库登记')
ON CONFLICT (version) DO NOTHING;
