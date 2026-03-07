-- Migration 134: tasks 表添加 failure_class 字段
-- 记录 cecelia-run 进程级别的失败分类（退出码 + stderr 分析）
-- 与 dev-failure-classifier.js 互补：本字段反映进程退出原因，
-- 而 payload.failure_classification 反映 AI 输出内容的语义分类

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS failure_class TEXT
    CHECK (failure_class IN ('resource_killed', 'env_setup', 'code_error'));

-- 索引：快速查询各分类的失败任务（运维分析用）
CREATE INDEX IF NOT EXISTS idx_tasks_failure_class ON tasks (failure_class) WHERE failure_class IS NOT NULL;

INSERT INTO schema_version (version, description)
  VALUES ('134', 'tasks.failure_class: cecelia-run 退出码→失败分类（resource_killed/env_setup/code_error）');
