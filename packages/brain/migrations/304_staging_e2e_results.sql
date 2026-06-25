-- Migration 304: staging_e2e_results 表 + staging_e2e task_type
--
-- 背景（阶段2 Slice1）：harness sub_task 合并后，reportNode 派生一个
--   task_type='staging_e2e' 的 Brain 任务（独立于 langgraph，不碰 interrupt）。
--   该任务复用 scripts/staging-deploy.sh 把 Brain 部署到 :5222，在真 staging 实例上
--   跑 contract E2E，verdict（PASS/FAIL/SKIP）落本表。
--   不碰人工放行 / promote / report（Slice2/3）。
--
-- 基于 287_add_harness_intervention_task_type.sql，追加 staging_e2e。

-- ── 1. staging_e2e_results 表 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging_e2e_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID REFERENCES tasks(id) ON DELETE CASCADE,
  initiative_id     UUID NOT NULL,
  pr_url            TEXT,
  verdict           VARCHAR(10) NOT NULL CHECK (verdict IN ('PASS', 'FAIL', 'SKIP')),
  -- SKIP/FAIL 的机器可读原因：no_docker / no_env / deploy_failed / no_contract / scenarios_failed
  reason            TEXT,
  staging_port      INTEGER NOT NULL DEFAULT 5222,
  scenarios_total   INTEGER NOT NULL DEFAULT 0,
  scenarios_passed  INTEGER NOT NULL DEFAULT 0,
  failed_scenarios  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{name, output, exitCode}]
  deploy_output     TEXT,
  deployed_at       TIMESTAMPTZ,
  tested_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staging_e2e_results_task ON staging_e2e_results(task_id);
CREATE INDEX IF NOT EXISTS idx_staging_e2e_results_initiative ON staging_e2e_results(initiative_id);
CREATE INDEX IF NOT EXISTS idx_staging_e2e_results_verdict ON staging_e2e_results(verdict);

-- ── 2. tasks.task_type CHECK 约束追加 staging_e2e ────────────────────────────
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
    -- 阶段2 Slice1：harness merge 后 staging 部署 + 自动 E2E（本 migration 新增）
    'staging_e2e'
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('304', 'staging_e2e_results table + staging_e2e task_type', NOW())
ON CONFLICT (version) DO NOTHING;
