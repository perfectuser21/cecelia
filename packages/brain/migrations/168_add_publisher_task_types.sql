-- Migration 168: Add multi-platform publisher task types
-- Required for activating multi-platform content publishing system

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type = ANY (ARRAY[
    'dev', 'review', 'talk', 'data', 'research',
    'exploratory', 'explore', 'knowledge',
    'qa', 'audit', 'decomp_review',
    'codex_qa', 'codex_dev', 'codex_playwright',
    'pr_review',
    'code_review', 'initiative_plan', 'initiative_verify',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced',
    'architecture_design', 'architecture_scan', 'arch_review',
    'strategy_session',
    'intent_expand', 'cto_review',
    -- Pipeline v2 Gate 类型
    'spec_review', 'code_review_gate',
    'prd_review', 'initiative_review', 'initiative_execute',
    -- Scope 层飞轮（Project→Scope→Initiative）
    'scope_plan', 'project_plan',
    -- 内容工厂任务类型（带连字符格式）
    'content-pipeline', 'content-research', 'content-generate', 'content-review', 'content-export',
    -- 其他现有任务类型
    'stuck_diagnosis',
    -- 多平台发布器任务类型
    'douyin_publish', 'kuaishou_publish', 'xiaohongshu_publish', 'weibo_publish',
    'wechat_publish', 'zhihu_publish', 'toutiao_publish', 'shipinhao_publish'
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('168', 'add multi-platform publisher task types for content publishing system', NOW())
ON CONFLICT (version) DO NOTHING;