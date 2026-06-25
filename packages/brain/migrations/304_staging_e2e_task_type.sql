-- Migration 304: 添加 staging_e2e task_type
-- 背景：阶段2 Slice1 —— harness sub_task PR 合并后，由 runSubTaskNode 创建
--       task_type=staging_e2e 的 Brain 任务。该任务独立于 langgraph（不是 graph 节点、
--       不碰 interrupt），由 staging-e2e-plugin tick 内联执行：复用 staging-deploy.sh
--       部署 :5222 → 在真 staging 实例跑 contract E2E → verdict 落 staging_e2e_results。
--       新 task_type 必须先进 tasks_task_type_check 约束，否则 INSERT 被拒。
-- 基于 287_add_harness_intervention_task_type.sql，追加 staging_e2e。

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
    -- Harness Initiative Patrol 干预任务
    'harness_intervention',
    -- 阶段2 Slice1：merge 后 staging 部署 + 自动 E2E（本 migration 新增）
    'staging_e2e'
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('304', 'add staging_e2e task_type for post-merge staging deploy + e2e', NOW())
ON CONFLICT (version) DO NOTHING;
