-- Migration 370: Harness Golden Path 定版治理裁决
-- Owner final PRD: 2026-07-29
--
-- 本迁移只完成 PRD §6 ①：
--   1. 两条封版判据 + 固定拒绝话术
--   2. 产权变更 B + 生效条件和理由
--   3. 高风险清单固化为 global invariant
--   4. 分类存疑向上默认 + Risk Tier 单向棘轮
--   5. 全局默认让路顺序
--
-- 后续合同 Gate 必须按 context.policy_key 读取机器字段，不能按中文 topic 分支。

ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_level_chk;
ALTER TABLE decisions ADD CONSTRAINT decisions_level_chk
  CHECK (level IS NULL OR level IN ('global', 'area', 'ability', 'feature', 'step'));

-- 只约束本 PRD 的稳定 namespace；不对历史 source_ref 追加全局唯一性。
CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_gp_governance_source_ref
  ON decisions (source_ref)
  WHERE source_ref LIKE 'harness-gp-governance-prd:%';

WITH finalized_policies (
  source_ref,
  category,
  topic,
  decision,
  reason,
  level,
  context
) AS (
  VALUES
    (
      'harness-gp-governance-prd:gp.sealing.element-criterion:v1',
      'governance',
      'Harness GP 封版：要素层判据',
      '每步单独回答、逐步不同、且未被四区收留的属性，才有资格成为要素。11 要素封版，不再增补。',
      '防止机制、合同或四区属性被误加为第 12 个要素。',
      'global',
      jsonb_build_object(
        'policy_key', 'gp.sealing.element-criterion',
        'policy_version', 1,
        'rule_type', 'sealed_admission_criterion',
        'applies_to', 'step_element_proposals',
        'requirements', jsonb_build_array(
          'answered_per_step',
          'differs_by_step',
          'not_already_hosted_by_four_zones'
        ),
        'on_reject', 'route_without_reopening_eleven_elements'
      )
    ),
    (
      'harness-gp-governance-prd:gp.sealing.contract-criterion:v1',
      'governance',
      'Harness GP 封版：合同层判据',
      '每 GP 单独回答、且必须人签字的属性，才有资格进合同。',
      '防止逐步属性或纯机制被误放进七项 GP 合同。',
      'global',
      jsonb_build_object(
        'policy_key', 'gp.sealing.contract-criterion',
        'policy_version', 1,
        'rule_type', 'sealed_admission_criterion',
        'applies_to', 'gp_contract_proposals',
        'requirements', jsonb_build_array(
          'answered_per_golden_path',
          'requires_human_signature'
        ),
        'on_reject', 'route_to_element_mechanism_or_four_zones'
      )
    ),
    (
      'harness-gp-governance-prd:gp.sealing.rejection-template:v1',
      'governance',
      'Harness GP 封版：固定拒绝话术',
      '该提议不满足要素层判据（非逐步不同 / 已被四区收留），按封版规则分流至 [合同层第 N 项 / 机制层 XX / 四区 XX]。11 要素封版，不再增补。依据：decisions#[编号]。',
      '提供可直接复制的封版分流回复，避免每次重新讨论 11 要素。',
      'global',
      jsonb_build_object(
        'policy_key', 'gp.sealing.rejection-template',
        'policy_version', 1,
        'rule_type', 'response_template',
        'template_slots', jsonb_build_array('destination', 'decision_number'),
        'requires_destination', true,
        'requires_decision_reference', true
      )
    ),
    (
      'harness-gp-governance-prd:gp.ownership-transfer.b:v1',
      'governance',
      'Harness GP 产权变更：方案 B',
      'FR、NFR、判定点、两轴衔接由 AI 起草、红方攻击、员工审查；偏离 GP 合同或触碰命门/高风险清单时上浮 Owner。该变更仅在红方接线与断言盖章均上线后生效。',
      '权和闸同步交接，不裸奔。红方攻击拦草稿质量，断言盖章拦纸面断言；两道闸未建成前不把“人写”切换为“人批”。',
      'global',
      jsonb_build_object(
        'policy_key', 'gp.ownership-transfer.b',
        'policy_version', 1,
        'rule_type', 'conditional_ownership_transfer',
        'selection', 'B',
        'draft_owner', 'ai',
        'review_chain', jsonb_build_array('red_team', 'employee_review'),
        'escalate_on', jsonb_build_array('contract_deviation', 'lifeline_hit', 'high_risk_hit'),
        'effective_when', jsonb_build_array(
          'red_team_wiring_live',
          'assertion_stamping_live'
        ),
        'effective_now', false
      )
    ),
    (
      'harness-gp-governance-prd:gp.high-risk.global-invariant:v1',
      'invariant',
      'Harness GP 全局高风险清单',
      '权限、资金、外部发布、生产数据命中任一项时，无论执行线分类为何，强制真人确认。',
      '高风险清单是凌驾于四条执行线之上的全局 invariant。',
      'global',
      jsonb_build_object(
        'policy_key', 'gp.high-risk.global-invariant',
        'policy_version', 1,
        'rule_type', 'global_human_gate',
        'category', 'invariant',
        'level', 'global',
        'risk_domains', jsonb_build_array(
          'permission',
          'money',
          'external_publish',
          'production_data'
        ),
        'applies_to_lines', jsonb_build_array(
          'new_golden_path',
          'thicken_golden_path',
          'bug_fix',
          'parameter_change'
        ),
        'action', 'require_human_confirmation',
        'risk_tier_can_downgrade', false
      )
    ),
    (
      'harness-gp-governance-prd:gp.classification-and-yield-defaults:v1',
      'governance',
      'Harness GP 分类与冲突裁决默认值',
      '执行线归类存疑时向上默认；Bug 与加厚存疑按加厚。Risk Tier 只能升级 Gate，永不降级。全局默认让路顺序为：安全/资金正确性 > 数据一致性 > 功能完整 > 性能 > 体验顺滑。',
      '为分类防御和 AI 冲突自裁提供稳定、机器可读的全局默认值。',
      'global',
      jsonb_build_object(
        'policy_key', 'gp.classification-and-yield-defaults',
        'policy_version', 1,
        'rule_type', 'classification_and_conflict_defaults',
        'classification_on_ambiguity', 'upgrade',
        'bug_vs_thicken', 'thicken_golden_path',
        'risk_tier_direction', 'upgrade_only',
        'yield_order', jsonb_build_array(
          'safety_and_financial_correctness',
          'data_consistency',
          'functional_completeness',
          'performance',
          'experience_smoothness'
        ),
        'yield_order_labels', jsonb_build_array(
          '安全/资金正确性',
          '数据一致性',
          '功能完整',
          '性能',
          '体验顺滑'
        )
      )
    )
)
INSERT INTO decisions (
  category,
  topic,
  decision,
  reason,
  status,
  level,
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
  category,
  topic,
  decision,
  reason,
  'active',
  level,
  'v1',
  context,
  source_ref,
  'owner',
  'user',
  'P0',
  'Harness Golden Path',
  TIMESTAMPTZ '2026-07-29 00:00:00+08',
  NOW()
FROM finalized_policies
ON CONFLICT (source_ref)
  WHERE source_ref LIKE 'harness-gp-governance-prd:%'
DO UPDATE SET
  category = EXCLUDED.category,
  topic = EXCLUDED.topic,
  decision = EXCLUDED.decision,
  reason = EXCLUDED.reason,
  status = EXCLUDED.status,
  level = EXCLUDED.level,
  scope = EXCLUDED.scope,
  context = EXCLUDED.context,
  author = EXCLUDED.author,
  made_by = EXCLUDED.made_by,
  priority = EXCLUDED.priority,
  area = EXCLUDED.area,
  decided_at = EXCLUDED.decided_at,
  updated_at = NOW();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('370', 'Seed finalized Harness Golden Path governance decisions', NOW())
ON CONFLICT (version) DO NOTHING;
