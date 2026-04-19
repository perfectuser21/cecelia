-- Migration 239: Harness v2 新 task_type
-- PRD: docs/design/harness-v2-prd.md §4.1
-- 基于 232_add_harness_generator_task_type.sql 的清单，追加 3 个新类型：
--   harness_initiative  — 阶段 A 入口（一个 Initiative 一条）
--   harness_task        — 阶段 B 单 Task（内部状态机）
--   harness_final_e2e   — 阶段 C 最终 E2E 验收
-- 保留所有 v1 老类型（向后兼容，历史数据不破坏）

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
    -- Harness v4.0 类型（保留）
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
    -- Harness v2 新类型（本 migration 新增）
    'harness_initiative',     -- 阶段 A 入口
    'harness_task',           -- 阶段 B 单 Task
    'harness_final_e2e'       -- 阶段 C 最终 E2E
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('239', 'Harness v2: 新 task_type（harness_initiative/harness_task/harness_final_e2e）', NOW())
ON CONFLICT (version) DO NOTHING;
