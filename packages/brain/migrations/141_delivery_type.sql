-- Migration 140: 添加 delivery_type 字段到 tasks 表
-- 用途：声明任务交付类型，区分文档/代码/行为变化
-- 取值：doc-only | code-only | doc+code | behavior-change
-- 默认：code-only（向后兼容）

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(50) DEFAULT 'code-only';

COMMENT ON COLUMN tasks.delivery_type IS
  'Task delivery type: doc-only | code-only | doc+code | behavior-change. behavior-change requires runtime evidence.';
