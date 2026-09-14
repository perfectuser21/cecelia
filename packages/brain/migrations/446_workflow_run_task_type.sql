-- Migration 446: 扩展 tasks_task_type_check — 加入 workflow_run
-- 「一切执行进 tasks 账」（决策 2dbabb48）：OpenClaw/n8n 业务流程派发不再绕账，
-- 派发时建 workflow_run task（in_progress），run 终态由 syncOpenClawRuns 回写。
-- 同 migration 335/336 同款修法：DROP + 重建，保留现行全部值。

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN (
    'dev', 'review', 'talk', 'data', 'research', 'exploratory',
    'explore', 'knowledge', 'qa', 'audit', 'decomp_review', 'codex_qa',
    'codex_dev', 'codex_test_gen', 'pr_review', 'code_review',
    'initiative_plan', 'initiative_verify', 'initiative_execute',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced',
    'architecture_design', 'architecture_scan', 'arch_review',
    'strategy_session', 'intent_expand', 'cto_review', 'spec_review',
    'code_review_gate', 'prd_review', 'initiative_review',
    'scope_plan', 'project_plan', 'okr_initiative_plan',
    'okr_scope_plan', 'okr_project_plan',
    'content-pipeline', 'content-research', 'content-generate',
    'content-review', 'content-export', 'content_publish',
    'content-copywriting', 'content-copy-review', 'content-image-review',
    'pipeline_rescue', 'crystallize', 'crystallize_scope',
    'crystallize_forge', 'crystallize_verify', 'crystallize_register',
    'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review',
    'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'sprint_report',
    'cecelia_event', 'harness_planner', 'harness_contract_propose',
    'harness_contract_review', 'harness_generate', 'harness_generator',
    'harness_ci_watch', 'harness_evaluate', 'harness_fix',
    'harness_deploy_watch', 'harness_report', 'platform_scraper',
    'harness_initiative', 'harness_task', 'harness_final_e2e',
    'trigger_backup', 'harness_intervention', 'staging_e2e', 'skill_eval',
    'ci_patrol', 'golden_path_proposal', 'strategist_decision',
    'workflow_run'
  )
);

INSERT INTO schema_version (version, description)
VALUES ('446', 'Add workflow_run to tasks_task_type_check constraint')
ON CONFLICT (version) DO NOTHING;
