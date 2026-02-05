-- Task Type Review Merge Migration
-- Created: 2026-02-05
-- Purpose: Merge qa + audit → review, add talk type

-- 1. Drop old constraint
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;

-- 2. Add updated constraint with new types
ALTER TABLE tasks
ADD CONSTRAINT tasks_task_type_check
CHECK (task_type IN (
    'dev',        -- 开发：完整代码读写
    'review',     -- 审查：只读代码，输出报告（合并原 qa + audit）
    'talk',       -- 对话：只写文档，不改代码
    'automation', -- N8N：调 API
    'research',   -- 研究：完全只读
    -- 保留兼容旧类型（executor 会映射到 review）
    'qa',
    'audit'
));

-- 3. Update comment
COMMENT ON COLUMN tasks.task_type IS 'Task type for routing: dev/review/talk/automation/research (qa/audit are legacy, mapped to review)';

-- 4. Optionally migrate existing qa/audit tasks to review
-- (不自动迁移，保持兼容，executor 会处理映射)
-- UPDATE tasks SET task_type = 'review' WHERE task_type IN ('qa', 'audit');
