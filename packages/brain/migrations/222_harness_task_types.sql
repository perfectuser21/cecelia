-- Migration 222: Harness v4.0 — rename sprint_* → harness_*, add harness_ci_watch / harness_deploy_watch

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type = ANY (ARRAY[
    -- 基础类型
    'dev', 'review', 'talk', 'data', 'research',
    'exploratory', 'explore', 'knowledge',
    'qa', 'audit', 'decomp_review',
    -- Codex 类型
    'codex_qa', 'codex_dev', 'codex_test_gen', 'pr_review',
    -- 系统类型
    'code_review', 'initiative_plan', 'initiative_verify', 'initiative_execute',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced',
    'architecture_design', 'architecture_scan', 'arch_review',
    'strategy_session', 'intent_expand', 'cto_review',
    -- Pipeline v2 Gate 类型
    'spec_review', 'code_review_gate', 'prd_review', 'initiative_review',
    -- Scope 层飞轮
    'scope_plan', 'project_plan',
    -- OKR 新表飞轮
    'okr_initiative_plan', 'okr_scope_plan', 'okr_project_plan',
    -- 内容工厂 Pipeline
    'content-pipeline', 'content-research', 'content-generate',
    'content-review', 'content-export', 'content_publish',
    'content-copywriting', 'content-copy-review', 'content-image-review',
    -- 救援类型
    'pipeline_rescue',
    -- crystallize 能力蒸馏流水线
    'crystallize', 'crystallize_scope', 'crystallize_forge',
    'crystallize_verify', 'crystallize_register',
    -- Harness v3.x 旧类型（向后兼容，历史数据保留）
    'sprint_planner',
    'sprint_contract_propose',
    'sprint_contract_review',
    'sprint_generate',
    'sprint_evaluate',
    'sprint_fix',
    'sprint_report',
    'cecelia_event',
    -- Harness v4.0 新类型（sprint_* → harness_*，并新增 CI/Deploy watch）
    'harness_planner',           -- Layer 1: 需求→PRD（原 sprint_planner）
    'harness_contract_propose',  -- Layer 2a: Generator 提合同草案（原 sprint_contract_propose）
    'harness_contract_review',   -- Layer 2b: Evaluator 挑战合同（原 sprint_contract_review）
    'harness_generate',          -- Layer 3a: Generator 写代码（原 sprint_generate）
    'harness_ci_watch',          -- Layer 3b: Brain tick 轮询 CI（新增，不派 agent）
    'harness_evaluate',          -- Layer 3c: Evaluator 验证 PR diff（原 sprint_evaluate）
    'harness_fix',               -- Layer 3d: Generator 修复（原 sprint_fix）
    'harness_deploy_watch',      -- Layer 3e: Brain tick 轮询 CD（新增，不派 agent）
    'harness_report'             -- Layer 4: 最终报告（原 sprint_report）
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('222', 'Harness v4.0: harness_* task types + harness_ci_watch + harness_deploy_watch', NOW())
ON CONFLICT (version) DO NOTHING;
