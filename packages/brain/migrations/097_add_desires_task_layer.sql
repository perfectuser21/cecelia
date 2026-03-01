-- Migration 097: 为 desires 表增加 task_layer 字段
--
-- 用于统一意图路由层，所有意图（欲望/聊天/Cortex）识别后存储层级信息

ALTER TABLE desires
ADD COLUMN IF NOT EXISTS task_layer VARCHAR(20);

-- 添加注释说明
COMMENT ON COLUMN desires.task_layer IS '任务层级（Layer 1-6），用于路由到秋米拆解或 /dev';

-- 创建索引加速路由查询
CREATE INDEX IF NOT EXISTS idx_desires_task_layer
  ON desires (task_layer)
  WHERE task_layer IS NOT NULL;

-- 更新 schema version
INSERT INTO schema_version (version, description)
VALUES ('097', 'Add task_layer to desires for unified intent routing')
ON CONFLICT (version) DO NOTHING;
