-- Migration: 新增 Sprint Harness task types
--
-- 背景：
--   Sprint Harness v2.0 引入三角循环：Generate → Evaluate → Fix → Evaluate
--   需要三个专用 task_type 支撑调度路由。
--
-- 新增类型：
--   sprint_generate  — Generator 角色：写代码，创建 PR
--   sprint_evaluate  — Evaluator 角色：验证 DoD，决定 pass/fix
--   sprint_fix       — Fixer 角色：根据 Evaluator 反馈修复代码

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
    -- 救援类型
    'pipeline_rescue',
    -- crystallize 能力蒸馏流水线
    'crystallize', 'crystallize_scope', 'crystallize_forge',
    'crystallize_verify', 'crystallize_register',
    -- Sprint Harness 三角循环（新增）
    'sprint_generate', 'sprint_evaluate', 'sprint_fix'
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  'add-sprint-task-types',
  'Sprint Harness task types: sprint_generate / sprint_evaluate / sprint_fix',
  NOW()
)
ON CONFLICT (version) DO NOTHING;
