-- Migration 321: 添加 skill_eval task_type
-- 背景：routes/eval.js 的 POST /api/skill-eval/upload 建 tasks 行时用 task_type='skill_eval'，
--       但该类型不在 tasks_task_type_check 约束中，导致上传接口自合并以来一直报
--       "column \"type\" of relation \"tasks\" does not exist"（列名错误，另修）
--       + 修完列名后仍会撞 CHECK 约束（本迁移解决）。
-- 基于当前真实约束定义（pg_get_constraintdef 核实，含 248/harness_intervention/staging_e2e 等
-- 后续迁移累积追加的全部值），追加 skill_eval

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
    -- Harness v3.x 旧类型（向后兼容）
    'sprint_planner',
    'sprint_contract_propose',
    'sprint_contract_review',
    'sprint_generate',
    'sprint_evaluate',
    'sprint_fix',
    'sprint_report',
    'cecelia_event',
    -- Harness v4.0 类型
    'harness_planner',
    'harness_contract_propose',
    'harness_contract_review',
    'harness_generate',
    'harness_generator',
    'harness_ci_watch',
    'harness_evaluate',
    'harness_fix',
    'harness_deploy_watch',
    'harness_report',
    -- 平台采集
    'platform_scraper',
    -- Harness v2 类型
    'harness_initiative',
    'harness_task',
    'harness_final_e2e',
    -- 备份调度
    'trigger_backup',
    -- 后续累积追加
    'harness_intervention',
    'staging_e2e',
    -- Skill Evaluator 上传评估（本 migration 新增）
    'skill_eval'
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('321', 'add skill_eval task_type for /api/skill-eval/upload', NOW())
ON CONFLICT (version) DO NOTHING;
