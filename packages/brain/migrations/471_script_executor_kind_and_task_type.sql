-- Migration 471: executor_kind 加 'script'，task_type 加 'script_run'
--
-- executor=script 一等任务类型（链 bf5088a3 棒 3，任务 5cdbd52a，决策 105a5868）：
-- 确定性脚本步与 AI 步同一条 DAG，由 Brain 经 ssh 在跑场机执行（us-vps 零执行，决策 96054a8b）。
--
-- 一、tasks_executor_kind_check：463 的八值 + 'script' = 九值。
--     lib 侧真身是 executor-contracts.js VALID_EXECUTOR_KINDS（测试机械对账）。
-- 二、tasks_task_type_check：461 的 85 值 + 'script_run' = 86 值。
--     lib 侧真身是 lib/task-type-registry.js DB_WHITELISTED_TASK_TYPES（测试机械对账）。
--
-- 拆法照 461/462、463/464：两条约束都 DROP + ADD ... NOT VALID——只登记目录项、不扫存量行（毫秒级），
-- 新写入立即受约束；"确认全表已合规"挪到 472 的 VALIDATE CONSTRAINT（SHARE UPDATE EXCLUSIVE，
-- 不挡并发读写），与本文件的 ACCESS EXCLUSIVE 分处两个事务。tasks 是高频写表，不能在一个事务里扫全表。
-- 全部 DDL 幂等：CI 会重放全部 migration。

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_executor_kind_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_executor_kind_check
    CHECK (executor_kind IS NULL OR executor_kind IN (
      'brain-local',
      'relay-container',
      'kernel-process',
      'headed-session',
      'bridge',
      'external-worker',
      'codex-review-local',
      'openclaw-agent',
      'script'
    )) NOT VALID;

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
    'strategist_decision', 'workflow_run', 'device_job', 'project', 'qiumi_task',
    'script_run'
  )
) NOT VALID;

INSERT INTO schema_version (version, description)
VALUES ('471', 'executor_kind 加 script + task_type 加 script_run（executor=script 一等任务类型，链 bf5088a3 棒3）')
ON CONFLICT (version) DO NOTHING;
