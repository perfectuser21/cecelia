-- Migration 017: Add 'data' task type to constraint
-- Date: 2026-02-07
-- Reason: Code uses 'data' type (routes to HK for data processing tasks)
--         but database constraint only allows dev/review/talk/automation/research/qa/audit

BEGIN;

-- Drop existing constraint
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;

-- Add new constraint with 'data' included
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
    task_type IN (
        'dev',        -- 开发：完整代码读写
        'review',     -- 审查：只读代码，输出报告（合并原 qa + audit）
        'talk',       -- 对话：只写文档，不改代码
        'data',       -- 数据处理：HK N8N workflows
        'automation', -- N8N：调 API
        'research',   -- 研究：完全只读
        -- 保留兼容旧类型（executor 会映射到 review）
        'qa',
        'audit'
    )
);

-- Update schema version
INSERT INTO schema_version (version) VALUES ('017');

COMMIT;
