-- Migration 373: finalized Golden Path PRD §③ data knife
--
-- Scope:
--   1. product NFR decisions target journey_steps explicitly;
--   2. truthful assertion_ref backfill on journey_step_links;
--   3. evidence-less legacy green/pending cells fail closed to red.
--
-- Non-scope: assertion stamping, last_verified, conflict accounting, retirement,
-- incident comparison, return-rate collection, or Phase 5.

BEGIN;

-- Product journey steps and legacy Harness golden_path rows are different
-- aggregates. Keep both target types explicit instead of overloading one label.
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_target_type_chk;
ALTER TABLE decisions ADD CONSTRAINT decisions_target_type_chk
  CHECK (
    target_type IS NULL
    OR target_type IN ('journey_feature', 'golden_path', 'journey_step', 'area')
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_gp_ledger_source_ref
  ON decisions (source_ref)
  WHERE source_ref LIKE 'gp-ledger-phase3:%';

WITH nfr_data(step_no, source_ref, topic, decision_text, reason_text) AS (
  VALUES
    (
      1,
      'gp-ledger-phase3:nfr:gp-b:s1',
      '消息感知时效与完整性',
      '客户消息在数秒内被感知；同一条消息不遗漏、不重复。',
      'GP-B S1 promise 与既有 no-drop 回归测试共同定义该步骤 NFR。'
    ),
    (
      2,
      'gp-ledger-phase3:nfr:gp-b:s2',
      '转人工可接续性',
      '命中转人工条件时必须送达可接续的真人处理入口。',
      'NFR 属于决定谁回答的业务步骤，不属于某个实现 feature。'
    ),
    (
      3,
      'gp-ledger-phase3:nfr:gp-b:s3',
      '回复质量、时效与送达',
      '回复必须得体、及时，并以真实送达回执作为完成条件。',
      'GP-B S3 promise 与 reply receipt 定义该步骤 NFR；质量验证仍待真实 evaluator。'
    ),
    (
      4,
      'gp-ledger-phase3:nfr:gp-b:s4',
      '留痕完整性与异常可行动性',
      '对话必须完整留痕；拉黑、停摆等异常必须产生可行动告警。',
      'GP-B S4 promise 定义留痕与善后的步骤级 NFR。'
    )
),
nfr_rows AS (
  SELECT
    s.id AS target_id,
    d.source_ref,
    d.topic,
    d.decision_text,
    d.reason_text
  FROM nfr_data d
  JOIN journey_steps s
    ON s.journey_id = 'ac2e35bc-849a-48cd-917f-79d15c5ac886'::uuid
   AND s.step_number = d.step_no
)
INSERT INTO decisions (
  category,
  topic,
  decision,
  reason,
  status,
  level,
  target_type,
  target_id,
  scope,
  context,
  source_ref,
  author,
  made_by,
  priority,
  area,
  decided_at,
  updated_at
)
SELECT
  'nfr',
  topic,
  decision_text,
  reason_text,
  'active',
  'step',
  'journey_step',
  target_id,
  'v1',
  jsonb_build_object(
    'policy_key', source_ref,
    'policy_version', 1,
    'home_inheritance', 'journey_steps.journey_id->journeys.home',
    'source', 'finalized-gp-prd-section-3'
  ),
  source_ref,
  'owner',
  'user',
  'P0',
  'Harness Golden Path',
  TIMESTAMPTZ '2026-07-30 00:00:00+08',
  NOW()
FROM nfr_rows
ON CONFLICT (source_ref)
  WHERE source_ref LIKE 'gp-ledger-phase3:%'
DO UPDATE SET
  category = EXCLUDED.category,
  topic = EXCLUDED.topic,
  decision = EXCLUDED.decision,
  reason = EXCLUDED.reason,
  status = EXCLUDED.status,
  level = EXCLUDED.level,
  target_type = EXCLUDED.target_type,
  target_id = EXCLUDED.target_id,
  scope = EXCLUDED.scope,
  context = EXCLUDED.context,
  author = EXCLUDED.author,
  made_by = EXCLUDED.made_by,
  priority = EXCLUDED.priority,
  area = EXCLUDED.area,
  decided_at = EXCLUDED.decided_at,
  updated_at = NOW();

-- Base-reference cells inherit an already approved real feature anchor. The
-- feature remains the anchor owner; the cell copy makes rerun/impact reads direct.
UPDATE journey_step_links AS cell
SET assertion_ref = COALESCE(
      feature.unit_test_path,
      feature.workflow_ref,
      feature.guard_ref
    )
FROM journey_features AS feature
WHERE cell.cell_kind = 'base_ref'
  AND cell.feature_id = feature.id
  AND cell.assertion_ref IS NULL
  AND COALESCE(
        feature.unit_test_path,
        feature.workflow_ref,
        feature.guard_ref
      ) IS NOT NULL;

-- The three MJ5 self-hosting rows mixed prose and a real test path. Store only
-- the executable repository path in assertion_ref.
UPDATE journey_step_links
SET assertion_ref = substring(
      assertion_ref
      FROM '(packages/brain/src/__tests__/[A-Za-z0-9_./-]+\.js)'
    )
WHERE assertion_ref LIKE '%packages/brain/src/__tests__/%';

-- Historical decision prose is traceable but not runnable.
UPDATE journey_step_links
SET assertion_ref = 'decision:' || assertion_ref
WHERE assertion_ref IS NOT NULL
  AND (
    assertion_ref LIKE '待拍板：%'
    OR assertion_ref LIKE '已拍板：%'
  );

-- Use the strongest truthful anchors available for the two green NFR cells.
-- S1 has an existing no-drop regression. S3 has no real evaluator contract yet,
-- so it points to the signed step decision and remains non-runnable.
UPDATE journey_step_links AS cell
SET assertion_ref =
  'zenithjoy/services/agent/wechat-rpa/tests/test_classify_unread_no_drop.py'
FROM journey_steps AS step
WHERE cell.step_id = step.id
  AND step.journey_id = 'ac2e35bc-849a-48cd-917f-79d15c5ac886'::uuid
  AND step.step_number = 1
  AND cell.cell_kind = 'element'
  AND cell.cell_key = 'NFR'
  AND cell.assertion_ref IS NULL;

UPDATE journey_step_links AS cell
SET assertion_ref = 'decision:gp-ledger-phase3:nfr:gp-b:s3'
FROM journey_steps AS step
WHERE cell.step_id = step.id
  AND step.journey_id = 'ac2e35bc-849a-48cd-917f-79d15c5ac886'::uuid
  AND step.step_number = 3
  AND cell.cell_kind = 'element'
  AND cell.cell_key = 'NFR'
  AND cell.assertion_ref IS NULL;

-- GP-B is backed by the existing ZenithJoy Path 4 real business smoke. This is
-- intentionally a whole-path command: it exercises API/DB/receipt behavior and
-- records its true-equivalence and real-machine boundaries in the script.
UPDATE journey_step_links AS cell
SET assertion_ref =
  'manual:cd ../zenithjoy && bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh'
FROM journey_steps AS step
WHERE cell.step_id = step.id
  AND step.journey_id = 'ac2e35bc-849a-48cd-917f-79d15c5ac886'::uuid
  AND cell.cell_status IN ('green', 'pending')
  AND cell.assertion_ref IS NULL
  AND cell.na_reason IS NULL;

-- A positive state without a defensible anchor is false confidence. Preserve the
-- cell and requirement, but fail closed until a real test/evaluation is attached.
UPDATE journey_step_links
SET cell_status = 'red'
WHERE cell_kind IS NOT NULL
  AND cell_status IN ('green', 'pending')
  AND assertion_ref IS NULL
  AND na_reason IS NULL;

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '373',
  'Golden Path §③ assertion backfill, step NFR homes, and product ledger convergence',
  NOW()
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
