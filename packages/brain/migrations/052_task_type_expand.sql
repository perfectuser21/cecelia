-- Migration 052: 扩展 task_type CHECK 约束
-- 新增 decomp_review（Vivian 拆解审查）和 codex_qa（Codex 免疫检查）

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN ('dev', 'review', 'talk', 'data', 'research', 'exploratory', 'qa', 'audit', 'decomp_review', 'codex_qa')
);

INSERT INTO schema_version (version) VALUES ('052');
