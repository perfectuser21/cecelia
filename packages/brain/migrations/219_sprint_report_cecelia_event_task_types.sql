-- Migration 219: 新增 sprint_report / cecelia_event 到 tasks_task_type_check 枚举约束

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
    -- Harness v2.0 官方三层
    'sprint_planner',           -- Layer 1: 需求→PRD
    'sprint_contract_propose',  -- Layer 2a: Generator 提合同草案
    'sprint_contract_review',   -- Layer 2b: Evaluator 挑战合同
    'sprint_generate',          -- Layer 3a: Generator 写代码
    'sprint_evaluate',          -- Layer 3b: Evaluator 测代码
    'sprint_fix',               -- Layer 3c: Generator 修复
    -- Harness v3.1 新增（本 migration）
    'sprint_report',            -- 生成 Sprint 报告
    'cecelia_event'             -- Cecelia 系统事件
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('219', 'Add sprint_report and cecelia_event to tasks_task_type_check', NOW())
ON CONFLICT (version) DO NOTHING;
