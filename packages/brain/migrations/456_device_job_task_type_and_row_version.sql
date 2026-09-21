-- Migration 456: device_job 任务类型 + tasks.row_version
--
-- 排程看板第一刀·Brain 地基（task 4c77ccce，决策 1e76f0b8）。
--
-- 一、tasks_task_type_check 纳入 device_job
--     device_job = 安卓工作机（手机）的活，由主理人在工作机页派单、Mac 领单器认领执行。
--     tasks_task_type_check 是**显式白名单**，不扩则第一条 INSERT 直接 23514 check_violation。
--     同 migration 327(ci_patrol) / 335(golden_path_proposal) 同款修法：DROP + 重建，
--     保留现行全部 82 个值（列表取自生产库 pg_get_constraintdef，不是抄旧 migration——
--     335 之后又加过 strategist_decision / workflow_run 等，抄旧列表会把它们打死）。
--
-- 二、tasks 加 row_version（乐观锁）
--     页面与 Notion 两处都能改同一条活的计划时间，必须有 CAS 依据。
--     不能用 updated_at：它是 timestamp WITHOUT time zone，且被 tick 定时 touch
--     （notion-push-sync 注释自陈「不能当增量判据」）——拿它当锁会两头错：
--     假冲突刷屏 + 同秒真冲突漏判。
--     NOT NULL DEFAULT 0 保证存量行也能直接参与 CAS，不需要回填。
--
-- 全部 DDL 幂等：CI 会重放全部 migration。

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
    'strategist_decision', 'workflow_run', 'device_job'
  )
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN tasks.row_version IS
  '乐观锁版本号。每次字段更新 +1；调用方带旧值做 CAS（UPDATE ... WHERE row_version = $n），不匹配返回 409。不要用 updated_at 代替——它会被 tick 定时 touch。';
