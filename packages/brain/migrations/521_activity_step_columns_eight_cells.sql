-- 521: 树+仓库定稿 v3.0 第二段第 1 刀（任务 dd66b90e，决策见 2026-10-05 "树+仓库定稿 v3.0"）
--
-- ① Activity（journey_steps，标准名视图 activities）加 10 列：inputs / outputs / preconditions / invariants / nfr / failure / readback
--    从 contract JSON 拆填（只填空值，contract 留作全量快照）；judgment / adversarial / shelf_life_days 新增；
-- ② Step（steps）加 5 列：name / action / inputs / outputs / on_fail（retry:N | abort）；name 先从 key 末段推；
-- ③ activity_items → activity_uses（Activity 用仓库的哪几件）；
-- ④ 8 格固定：每个未退役 Activity 恰好有 promise / nfr / judgment / invariants / failure / readback / adversarial / shelf_life 八个标准格；
--    客服线旧格子名按名映射；获客线 stage:* / regression:* 及所有场景格、能力点格标为 readback 的子项（parent_cell_key），
--    producer_source_revision 标为 invariants 子项；Step 级格子标为 readback 子项；缺的标准格补灰格；
-- ⑤ 顺序归关系表：有 workflow_id 但没有 workflow_activity_refs 行的 Activity 补行（sequence_no = step_number）；
-- ⑥ 标准名视图重建带上新列。物理表名本刀不动（第 2 刀换名）。改前原值进 migration_521_backup。
BEGIN;

CREATE TABLE IF NOT EXISTS migration_521_backup (
  table_name text NOT NULL,
  row_id     text NOT NULL,
  payload    jsonb NOT NULL,
  PRIMARY KEY (table_name, row_id)
);

-- ===== ① Activity 列
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS inputs jsonb;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS outputs jsonb;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS preconditions jsonb;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS invariants jsonb;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS nfr jsonb;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS failure jsonb;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS readback jsonb;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS judgment jsonb;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS adversarial text;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS shelf_life_days integer;

COMMENT ON COLUMN journey_steps.promise IS '承诺（FR）：一句话，用户或运维语言；AI 起草、主理人拍板';
COMMENT ON COLUMN journey_steps.inputs IS '进什么（机器写，来自合同 inputs）';
COMMENT ON COLUMN journey_steps.outputs IS '出什么、改哪张表（机器写，来自合同 outputs）';
COMMENT ON COLUMN journey_steps.preconditions IS '开始前必须成立（机器写，来自合同 preconditions）';
COMMENT ON COLUMN journey_steps.invariants IS '全程不能破（机器写，来自合同 idempotency + side_effects）';
COMMENT ON COLUMN journey_steps.nfr IS '时限/频控/规模（机器写，来自合同 budget + resources）';
COMMENT ON COLUMN journey_steps.failure IS '失败语义 fatal/retryable/empty_ok/needs_human（AI 起草，要人的档主理人拍板）';
COMMENT ON COLUMN journey_steps.readback IS '效果确认：做完去哪看、看到什么算成（机器写，来自合同 postconditions）';
COMMENT ON COLUMN journey_steps.judgment IS '判定点：对模糊现实怎么判、误判后果（AI 起草，误判后果主理人拍板）';
COMMENT ON COLUMN journey_steps.adversarial IS '对抗面：谁会来搞、怎么搞（AI 起草）';
COMMENT ON COLUMN journey_steps.shelf_life_days IS '多久没验要重验；默认 7，按流程频率调';
COMMENT ON COLUMN journey_steps.contract IS '合同全量快照（只读）；可查的字段已拆成列，以列为准';

UPDATE journey_steps SET
  inputs        = COALESCE(inputs, contract->'inputs'),
  outputs       = COALESCE(outputs, contract->'outputs'),
  preconditions = COALESCE(preconditions, contract->'preconditions'),
  invariants    = COALESCE(invariants, NULLIF(jsonb_strip_nulls(jsonb_build_object('idempotency', contract->'idempotency', 'side_effects', contract->'side_effects')), '{}'::jsonb)),
  nfr           = COALESCE(nfr, NULLIF(jsonb_strip_nulls(jsonb_build_object('budget', contract->'budget', 'resources', contract->'resources')), '{}'::jsonb)),
  failure       = COALESCE(failure, contract->'failure'),
  readback      = COALESCE(readback, contract->'postconditions'),
  updated_at    = NOW()
 WHERE contract IS NOT NULL
   AND (inputs IS NULL OR outputs IS NULL OR preconditions IS NULL OR invariants IS NULL OR nfr IS NULL OR failure IS NULL OR readback IS NULL);

UPDATE journey_steps SET shelf_life_days = 7 WHERE shelf_life_days IS NULL AND status <> 'deprecated';

-- ===== ② Step 列
ALTER TABLE steps ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE steps ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE steps ADD COLUMN IF NOT EXISTS inputs jsonb;
ALTER TABLE steps ADD COLUMN IF NOT EXISTS outputs jsonb;
ALTER TABLE steps ADD COLUMN IF NOT EXISTS on_fail text CHECK (on_fail IS NULL OR on_fail ~ '^(retry:[0-9]+|abort)$');
COMMENT ON COLUMN steps.name IS '小步名字；先从 key 末段推，合同同步/沉淀技能覆写';
COMMENT ON COLUMN steps.action IS '这一步做的动作，按脚本精度';
COMMENT ON COLUMN steps.inputs IS '进什么';
COMMENT ON COLUMN steps.outputs IS '出什么';
COMMENT ON COLUMN steps.readback IS '读回什么算这一步过（空 = 这一步没有验收标准，技能换脚本会炸）';
COMMENT ON COLUMN steps.on_fail IS 'retry:N 或 abort；其余失败处理查 Activity.failure';

UPDATE steps SET name = replace(split_part(key, '.', array_length(string_to_array(key, '.'), 1)), '_', ' ')
 WHERE name IS NULL AND key IS NOT NULL;

-- ===== ③ activity_items → activity_uses
ALTER TABLE activity_items RENAME TO activity_uses;
ALTER INDEX IF EXISTS idx_activity_items_item RENAME TO idx_activity_uses_item;
COMMENT ON TABLE activity_uses IS 'Activity 用仓库的哪几件（一行一件；原 activity_items，迁移 521 改名）';

-- ===== ④ 8 格固定
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS parent_cell_key text;
COMMENT ON COLUMN journey_step_links.parent_cell_key IS '非标准格时指向所属的标准格（场景格/能力点格/Step 级格 → readback；代码版本 → invariants）；标准 8 格为 NULL';

-- 旧格子名 → 8 个标准键（备份原名）
INSERT INTO migration_521_backup (table_name, row_id, payload)
SELECT 'journey_step_links.renamed', l.id::text, jsonb_build_object('cell_key', l.cell_key)
  FROM journey_step_links l
 WHERE l.cell_level = 'activity' AND l.cell_kind = 'element'
   AND l.cell_key IN ('FR', 'NFR', '判定点', '不变量', '失败语义', '效果确认', '对抗面', '保质期')
ON CONFLICT DO NOTHING;

UPDATE journey_step_links l SET cell_key = m.new_key, updated_at = NOW()
  FROM (VALUES
    ('FR', 'promise'), ('NFR', 'nfr'), ('判定点', 'judgment'), ('不变量', 'invariants'),
    ('失败语义', 'failure'), ('效果确认', 'readback'), ('对抗面', 'adversarial'), ('保质期', 'shelf_life')
  ) AS m(old_key, new_key)
 WHERE l.cell_level = 'activity' AND l.cell_kind = 'element' AND l.cell_key = m.old_key
   AND NOT EXISTS (SELECT 1 FROM journey_step_links x WHERE x.step_id = l.step_id AND x.cell_kind = l.cell_kind AND x.cell_key = m.new_key);

-- 其余 Activity 级格子（stage:* / regression:* / 场景 / 能力点 / 旧合同格）→ readback 的子项；代码版本 → invariants 子项
UPDATE journey_step_links SET parent_cell_key = 'readback', updated_at = NOW()
 WHERE cell_level = 'activity' AND cell_kind IN ('element', 'scenario', 'capability')
   AND cell_key NOT IN ('promise', 'nfr', 'judgment', 'invariants', 'failure', 'readback', 'adversarial', 'shelf_life')
   AND parent_cell_key IS NULL;
UPDATE journey_step_links SET parent_cell_key = 'invariants', updated_at = NOW()
 WHERE cell_level = 'activity' AND cell_key = 'producer_source_revision';
-- Step 级格子（旧机制）→ readback 子项；第 2 刀把它们并进 steps.readback 后删
UPDATE journey_step_links SET parent_cell_key = 'readback', updated_at = NOW()
 WHERE cell_level = 'step' AND parent_cell_key IS NULL;

-- 每个未退役 Activity 补齐 8 个标准格（灰），新行 id 记进备份
WITH ins AS (
  INSERT INTO journey_step_links (journey_id, step_id, cell_level, cell_kind, cell_key, cell_status, status, notion_synced_at)
  SELECT a.journey_id, a.id, 'activity', 'element', k.key, 'gray', 'planned', NULL
    FROM journey_steps a
    CROSS JOIN (VALUES ('promise'), ('nfr'), ('judgment'), ('invariants'), ('failure'), ('readback'), ('adversarial'), ('shelf_life')) AS k(key)
   WHERE a.status <> 'deprecated'
     AND NOT EXISTS (SELECT 1 FROM journey_step_links l WHERE l.step_id = a.id AND l.cell_level = 'activity' AND l.cell_kind = 'element' AND l.cell_key = k.key)
  RETURNING id
)
INSERT INTO migration_521_backup (table_name, row_id, payload)
SELECT 'journey_step_links.inserted', id::text, '{}'::jsonb FROM ins
ON CONFLICT DO NOTHING;

-- ===== ⑤ 顺序归关系表
INSERT INTO workflow_activity_refs (workflow_id, slot_key, activity_id, sequence_no, source_ref, active)
SELECT s.workflow_id, COALESCE(s.activity_key, 'step_' || s.step_number::text), s.id, s.step_number, 'migration:521', true
  FROM journey_steps s
 WHERE s.workflow_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM workflow_activity_refs r WHERE r.activity_id = s.id)
ON CONFLICT DO NOTHING;

-- ===== ⑥ 标准名视图重建（CREATE OR REPLACE 只能在末尾追加列，正合新列情形）
CREATE OR REPLACE VIEW activities AS SELECT * FROM journey_steps;
CREATE OR REPLACE VIEW activity_cells AS SELECT * FROM journey_step_links;

INSERT INTO schema_version (version, description)
VALUES ('521', 'v3.0 第 1 刀：Activity 加 10 列从 contract 拆填、Step 加 5 列、activity_items→activity_uses、8 格固定（旧名映射+子项+补灰格）、顺序归 workflow_activity_refs')
ON CONFLICT (version) DO NOTHING;

COMMIT;
