-- 回滚 471：把两条约束退回 463（executor_kind 八值）/ 461（task_type 85 值）的形状，删版本行。
-- 先把已有 script 行清理干净，否则 ADD CONSTRAINT 会被存量行挡住（重新 VALIDATE 也会失败）：
--   UPDATE tasks SET executor_kind = NULL WHERE executor_kind = 'script';
--   DELETE FROM tasks WHERE task_type = 'script_run';   -- 或先迁移为别的类型
-- 若 472 已应用，先跑 472 的 down（只删版本行），再跑本文件。
BEGIN;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_executor_kind_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_executor_kind_check
    CHECK (executor_kind IS NULL OR executor_kind IN (
      'brain-local', 'relay-container', 'kernel-process', 'headed-session', 'bridge',
      'external-worker', 'codex-review-local', 'openclaw-agent'
    ));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN (
    'dev', 'review', 'talk', 'data', 'research', 'exploratory', 'explore', 'knowledge',
    'qa', 'audit', 'decomp_review', 'codex_qa', 'codex_dev', 'codex_test_gen', 'pr_review',
    'code_review', 'initiative_plan', 'initiative_verify', 'initiative_execute',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced', 'architecture_design',
    'architecture_scan', 'arch_review', 'strategy_session', 'intent_expand', 'cto_review',
    'spec_review', 'code_review_gate', 'prd_review', 'initiative_review', 'scope_plan',
    'project_plan', 'okr_initiative_plan', 'okr_scope_plan', 'okr_project_plan',
    'content-pipeline', 'content-research', 'content-generate', 'content-review',
    'content-export', 'content_publish', 'content-copywriting', 'content-copy-review',
    'content-image-review', 'pipeline_rescue', 'crystallize', 'crystallize_scope',
    'crystallize_forge', 'crystallize_verify', 'crystallize_register', 'sprint_planner',
    'sprint_contract_propose', 'sprint_contract_review', 'sprint_generate',
    'sprint_evaluate', 'sprint_fix', 'sprint_report', 'cecelia_event', 'harness_planner',
    'harness_contract_propose', 'harness_contract_review', 'harness_generate',
    'harness_generator', 'harness_ci_watch', 'harness_evaluate', 'harness_fix',
    'harness_deploy_watch', 'harness_report', 'platform_scraper', 'harness_initiative',
    'harness_task', 'harness_final_e2e', 'trigger_backup', 'harness_intervention',
    'staging_e2e', 'skill_eval', 'ci_patrol', 'golden_path_proposal',
    'strategist_decision', 'workflow_run', 'device_job', 'project', 'qiumi_task'
  )
);
DELETE FROM schema_version WHERE version = '471';
COMMIT;
