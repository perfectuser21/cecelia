-- Migration 156: Add review_result column + pr_review task_type
-- 幂等设计，重复执行安全

-- 1. 添加 review_result 字段（审查结果文本）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_result TEXT;

-- 2. 更新 task_type 约束，加入 pr_review
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
    'strategy_session'
  ])
);

-- 3. 记录版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('156', 'add tasks.review_result + pr_review task_type constraint', NOW())
ON CONFLICT (version) DO NOTHING;
