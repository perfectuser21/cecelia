-- Migration 365: Cecelia Harness Pipeline F1 原位账本基线。
-- 只扩展 journeys / journey_steps / journey_step_links；不创建平行账本，
-- 不修改 merge、staging、production 运行时状态。

ALTER TABLE journey_steps
  ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT,
  ADD COLUMN IF NOT EXISTS is_backbone BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mapping_status TEXT,
  ADD COLUMN IF NOT EXISTS mapping_reason TEXT,
  ADD COLUMN IF NOT EXISTS mapping_evidence JSONB;

ALTER TABLE journey_steps DROP CONSTRAINT IF EXISTS journey_steps_lifecycle_stage_check;
ALTER TABLE journey_steps ADD CONSTRAINT journey_steps_lifecycle_stage_check
  CHECK (lifecycle_stage IS NULL OR lifecycle_stage ~ '^S([0-9]|1[0-2])$');
ALTER TABLE journey_steps DROP CONSTRAINT IF EXISTS journey_steps_mapping_status_check;
ALTER TABLE journey_steps ADD CONSTRAINT journey_steps_mapping_status_check
  CHECK (mapping_status IS NULL OR mapping_status IN ('exact','gap'));

ALTER TABLE journey_step_links
  ADD COLUMN IF NOT EXISTS reason_code TEXT,
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS missing_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_requirement TEXT;

-- 合同测试与 API 都按稳定 Unicode/codepoint 顺序核对精确 11 键；
-- 显式 C collation，避免宿主数据库 locale 改变中文键顺序。
ALTER TABLE journey_step_links
  ALTER COLUMN cell_key TYPE varchar(200) COLLATE "C";

DO $$
DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'journey_step_links'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%cell_status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS %I',
      constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE journey_step_links ADD CONSTRAINT jsl_cell_status_f1_check
  CHECK (cell_status IN ('gray','red','pending','green','na'));

UPDATE journeys
SET endpoint = 'production verified + rollback anchor recorded + report/learning reconciled',
    updated_at = NOW()
WHERE id = 'bb8cc561-b3ee-4fec-b74d-2255694bd963'
  AND name = 'Cecelia Harness Pipeline';

-- 先把同 stage 的历史别名移到不冲突的展示序号，保留原 ID/Notion 关联。
UPDATE journey_steps
SET step_number = CASE id
    WHEN 'e2bd9263-87ef-4461-a1d5-5ff07a38b8a8'::uuid THEN 303
    WHEN 'a6888ef3-2482-4655-8703-cf3b9f037cb9'::uuid THEN 306
  END,
  lifecycle_stage = CASE id
    WHEN 'e2bd9263-87ef-4461-a1d5-5ff07a38b8a8'::uuid THEN 'S3'
    WHEN 'a6888ef3-2482-4655-8703-cf3b9f037cb9'::uuid THEN 'S6'
  END,
  is_backbone = FALSE,
  mapping_status = 'gap',
  mapping_reason = 'co_stage_historical_alias',
  mapping_evidence = CASE id
    WHEN 'e2bd9263-87ef-4461-a1d5-5ff07a38b8a8'::uuid THEN
      '{"decision_source":"sprint-prd.md#边界情况","mapped_stage":"S3","backbone_step_id":"d6dcdfaf-4b98-4717-bbe3-522f03f70757"}'::jsonb
    WHEN 'a6888ef3-2482-4655-8703-cf3b9f037cb9'::uuid THEN
      '{"decision_source":"sprint-prd.md#边界情况","mapped_stage":"S6","backbone_step_id":"1a738e05-99a7-421c-a52d-c2bb80bf19be"}'::jsonb
  END,
  updated_at = NOW()
WHERE journey_id = 'bb8cc561-b3ee-4fec-b74d-2255694bd963'
  AND id IN (
    'e2bd9263-87ef-4461-a1d5-5ff07a38b8a8',
    'a6888ef3-2482-4655-8703-cf3b9f037cb9'
  );

-- UNIQUE(journey_id,step_number) 不是 deferrable；先移到临时序号再原位归档，
-- 避免 Planner 1→2 与 GAN Proposer 2→3 的行级更新碰撞。
UPDATE journey_steps
SET step_number = CASE id
    WHEN 'c5bae104-da5e-483d-b5ea-c295c90a3f28'::uuid THEN 202
    WHEN 'd6dcdfaf-4b98-4717-bbe3-522f03f70757'::uuid THEN 203
    WHEN '0cdadc1a-e3a0-46a1-8333-ebbc102883f7'::uuid THEN 204
    WHEN '1a738e05-99a7-421c-a52d-c2bb80bf19be'::uuid THEN 206
  END
WHERE journey_id = 'bb8cc561-b3ee-4fec-b74d-2255694bd963'
  AND id IN (
    'c5bae104-da5e-483d-b5ea-c295c90a3f28',
    'd6dcdfaf-4b98-4717-bbe3-522f03f70757',
    '0cdadc1a-e3a0-46a1-8333-ebbc102883f7',
    '1a738e05-99a7-421c-a52d-c2bb80bf19be'
  );

UPDATE journey_steps
SET step_number = CASE id
    WHEN 'c5bae104-da5e-483d-b5ea-c295c90a3f28'::uuid THEN 2
    WHEN 'd6dcdfaf-4b98-4717-bbe3-522f03f70757'::uuid THEN 3
    WHEN '0cdadc1a-e3a0-46a1-8333-ebbc102883f7'::uuid THEN 4
    WHEN '1a738e05-99a7-421c-a52d-c2bb80bf19be'::uuid THEN 6
  END,
  lifecycle_stage = CASE id
    WHEN 'c5bae104-da5e-483d-b5ea-c295c90a3f28'::uuid THEN 'S2'
    WHEN 'd6dcdfaf-4b98-4717-bbe3-522f03f70757'::uuid THEN 'S3'
    WHEN '0cdadc1a-e3a0-46a1-8333-ebbc102883f7'::uuid THEN 'S4'
    WHEN '1a738e05-99a7-421c-a52d-c2bb80bf19be'::uuid THEN 'S6'
  END,
  name = CASE id
    WHEN 'c5bae104-da5e-483d-b5ea-c295c90a3f28'::uuid THEN 'Planner'
    WHEN 'd6dcdfaf-4b98-4717-bbe3-522f03f70757'::uuid THEN 'Contract GAN'
    WHEN '0cdadc1a-e3a0-46a1-8333-ebbc102883f7'::uuid THEN 'Generator'
    WHEN '1a738e05-99a7-421c-a52d-c2bb80bf19be'::uuid THEN 'Evaluator'
  END,
  promise = CASE id
    WHEN 'c5bae104-da5e-483d-b5ea-c295c90a3f28'::uuid THEN '计划覆盖 FR/NFR/Invariant/真实 E2E，范围足够薄'
    WHEN 'd6dcdfaf-4b98-4717-bbe3-522f03f70757'::uuid THEN '对抗审核后的合同可执行且批准后不可偷改'
    WHEN '0cdadc1a-e3a0-46a1-8333-ebbc102883f7'::uuid THEN '在受控工作树先 Red 后 Green，创建 Harness-owned PR'
    WHEN '1a738e05-99a7-421c-a52d-c2bb80bf19be'::uuid THEN '新 session 真跑合同、反作弊和真实 E2E'
  END,
  is_backbone = TRUE,
  mapping_status = 'exact',
  mapping_reason = NULL,
  mapping_evidence = jsonb_build_object(
    'decision_source', 'sprint-prd.md#Golden Path',
    'mapped_stage', CASE id
      WHEN 'c5bae104-da5e-483d-b5ea-c295c90a3f28'::uuid THEN 'S2'
      WHEN 'd6dcdfaf-4b98-4717-bbe3-522f03f70757'::uuid THEN 'S3'
      WHEN '0cdadc1a-e3a0-46a1-8333-ebbc102883f7'::uuid THEN 'S4'
      WHEN '1a738e05-99a7-421c-a52d-c2bb80bf19be'::uuid THEN 'S6'
    END,
    'backbone_step_id', id
  ),
  updated_at = NOW()
WHERE journey_id = 'bb8cc561-b3ee-4fec-b74d-2255694bd963'
  AND id IN (
    'c5bae104-da5e-483d-b5ea-c295c90a3f28',
    'd6dcdfaf-4b98-4717-bbe3-522f03f70757',
    '0cdadc1a-e3a0-46a1-8333-ebbc102883f7',
    '1a738e05-99a7-421c-a52d-c2bb80bf19be'
  );

INSERT INTO journey_steps
  (id, journey_id, name, step_number, status, promise, backbone_version,
   lifecycle_stage, is_backbone, mapping_status, mapping_evidence)
SELECT
  v.id::uuid,
  v.journey_id::uuid,
  v.name,
  v.step_number,
  v.status,
  v.promise,
  v.backbone_version,
  v.lifecycle_stage,
  v.is_backbone,
  v.mapping_status,
  v.mapping_evidence::jsonb
FROM (VALUES
  ('4540991e-17ca-4f31-a318-8ab18f856b31','bb8cc561-b3ee-4fec-b74d-2255694bd963','Task Born',0,'planned','每个任务有稳定身份、来源、仓库、环境、风险和锚点','1.0','S0',TRUE,'exact','{"decision_source":"sprint-prd.md#Golden Path","mapped_stage":"S0","backbone_step_id":"4540991e-17ca-4f31-a318-8ab18f856b31"}'),
  ('a5ce672f-2202-4eae-a74d-2da323dc64ff','bb8cc561-b3ee-4fec-b74d-2255694bd963','Intent / PrepPRD',1,'planned','用户意图、成功标准、真实旅程和依赖被冻结','1.0','S1',TRUE,'exact','{"decision_source":"sprint-prd.md#Golden Path","mapped_stage":"S1","backbone_step_id":"a5ce672f-2202-4eae-a74d-2da323dc64ff"}'),
  ('f12be1d5-ae65-4813-b2d8-cfde24ac5ac6','bb8cc561-b3ee-4fec-b74d-2255694bd963','CI',5,'planned','客观检查全绿，只产证据，不持有 Harness merge 权','1.0','S5',TRUE,'exact','{"decision_source":"sprint-prd.md#Golden Path","mapped_stage":"S5","backbone_step_id":"f12be1d5-ae65-4813-b2d8-cfde24ac5ac6"}'),
  ('9a8b4080-97f5-46a0-848e-6428ac881d1b','bb8cc561-b3ee-4fec-b74d-2255694bd963','Independent Judge',7,'planned','独立复核 Evaluator 证据并给最终机器裁决','1.0','S7',TRUE,'exact','{"decision_source":"sprint-prd.md#Golden Path","mapped_stage":"S7","backbone_step_id":"9a8b4080-97f5-46a0-848e-6428ac881d1b"}'),
  ('de269b2e-46aa-4d5a-afea-1bc4558b0fef','bb8cc561-b3ee-4fec-b74d-2255694bd963','Risk-based Human Review',8,'planned','首次/高风险变更在 merge 前由主理人查看','1.0','S8',TRUE,'exact','{"decision_source":"sprint-prd.md#Golden Path","mapped_stage":"S8","backbone_step_id":"de269b2e-46aa-4d5a-afea-1bc4558b0fef"}'),
  ('d6f3c80a-5e48-4058-b7e5-f972f1a23ee1','bb8cc561-b3ee-4fec-b74d-2255694bd963','Merge',9,'planned','只有唯一 Merge Authority 在全部门禁满足后合并','1.0','S9',TRUE,'exact','{"decision_source":"sprint-prd.md#Golden Path","mapped_stage":"S9","backbone_step_id":"d6f3c80a-5e48-4058-b7e5-f972f1a23ee1"}'),
  ('004993cf-01ff-422d-b45a-14328361279b','bb8cc561-b3ee-4fec-b74d-2255694bd963','Staging',10,'planned','部署并验证刚合并的精确 artifact','1.0','S10',TRUE,'exact','{"decision_source":"sprint-prd.md#Golden Path","mapped_stage":"S10","backbone_step_id":"004993cf-01ff-422d-b45a-14328361279b"}'),
  ('0e7a817c-d8ef-4f9a-8561-4300fe6b547a','bb8cc561-b3ee-4fec-b74d-2255694bd963','Production',11,'planned','按发布策略 promote、验活并留回滚锚点','1.0','S11',TRUE,'exact','{"decision_source":"sprint-prd.md#Golden Path","mapped_stage":"S11","backbone_step_id":"0e7a817c-d8ef-4f9a-8561-4300fe6b547a"}'),
  ('4d0ed49c-4949-4e8b-90f3-6840d58f39fe','bb8cc561-b3ee-4fec-b74d-2255694bd963','Report / Learning / Complete',12,'planned','更新承诺地图、回归、学习和外部状态后才收账','1.0','S12',TRUE,'exact','{"decision_source":"sprint-prd.md#Golden Path","mapped_stage":"S12","backbone_step_id":"4d0ed49c-4949-4e8b-90f3-6840d58f39fe"}')
) AS v(
  id, journey_id, name, step_number, status, promise, backbone_version,
  lifecycle_stage, is_backbone, mapping_status, mapping_evidence
)
JOIN journeys j ON j.id=v.journey_id::uuid
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name,
  step_number=EXCLUDED.step_number,
  promise=EXCLUDED.promise,
  lifecycle_stage=EXCLUDED.lifecycle_stage,
  is_backbone=TRUE,
  mapping_status='exact',
  mapping_reason=NULL,
  mapping_evidence=EXCLUDED.mapping_evidence,
  updated_at=NOW();

WITH elements(element) AS (
  VALUES ('FR'),('NFR'),('Invariant'),('判定点'),('保质期'),('死亡告警'),
         ('失败语义'),('效果确认'),('输入对抗面'),('账本保鲜'),('两轴衔接')
), backbone AS (
  SELECT id, journey_id, step_number, lifecycle_stage
  FROM journey_steps
  WHERE journey_id='bb8cc561-b3ee-4fec-b74d-2255694bd963'
    AND is_backbone=TRUE
)
INSERT INTO journey_step_links
  (journey_id, step_id, step_order, status, cell_kind, cell_key, cell_status,
   assertion_ref, na_reason, reason_code, source_refs, missing_evidence,
   evidence_requirement, notion_synced_at)
SELECT
  b.journey_id, b.id, b.step_number, 'planned', 'element', e.element,
  CASE WHEN e.element='FR' THEN 'pending' ELSE 'gray' END,
  NULL, NULL,
  CASE WHEN e.element='FR'
    THEN 'awaiting_executable_evidence' ELSE 'requirement_undefined' END,
  CASE WHEN e.element='FR'
    THEN jsonb_build_array('sprints/07271239-kernel-harness-11-elements-baseline/contract-draft.md#Golden Path')
    ELSE '[]'::jsonb END,
  CASE WHEN e.element='FR'
    THEN '["current_sha_pass"]'::jsonb ELSE '["requirement_definition"]'::jsonb END,
  CASE WHEN e.element='FR'
    THEN '绑定 current SHA 的可重复行为 PASS'
    ELSE '定义该 stage 的要素要求并补可执行证据' END,
  NOW()
FROM backbone b CROSS JOIN elements e
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL
DO UPDATE SET
  step_order=EXCLUDED.step_order,
  cell_status=EXCLUDED.cell_status,
  assertion_ref=EXCLUDED.assertion_ref,
  na_reason=EXCLUDED.na_reason,
  reason_code=EXCLUDED.reason_code,
  source_refs=EXCLUDED.source_refs,
  missing_evidence=EXCLUDED.missing_evidence,
  evidence_requirement=EXCLUDED.evidence_requirement,
  notion_synced_at=EXCLUDED.notion_synced_at;
