-- Migration 318: skill_eval task_type + evals 表
-- 为 Skill Evaluator 内部验收台（形态B）thin 贯穿创建必要的 DB 结构

-- ── 1. evals 表（评估记录）─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID REFERENCES tasks(id) ON DELETE SET NULL,
  skill_name    TEXT NOT NULL,
  platform      TEXT,
  line          TEXT,
  submitter     TEXT,
  zip_hash      TEXT NOT NULL,           -- SHA256，用于去重
  zip_path      TEXT,                     -- staging 文件路径
  report_url    TEXT,
  failure_stage TEXT,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','in_progress','completed','failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evals_task_id   ON evals(task_id);
CREATE INDEX IF NOT EXISTS idx_evals_zip_hash  ON evals(zip_hash);
CREATE INDEX IF NOT EXISTS idx_evals_status    ON evals(status);
CREATE INDEX IF NOT EXISTS idx_evals_created   ON evals(created_at DESC);

-- ── 2. task_type CHECK 约束追加 skill_eval ──────────────────────────────────
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
    -- 阶段2 Slice1：harness merge 后 staging 部署 + 自动 E2E
    'staging_e2e',
    -- Skill Evaluator 内部验收台
    'skill_eval'
  ])
);
