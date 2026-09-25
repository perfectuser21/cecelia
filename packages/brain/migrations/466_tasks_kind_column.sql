-- Migration 466: tasks.kind 真列（agent | workflow）+ 按注册表回填
--
-- 任务类型模型收敛·第一刀（任务 94465721，链 bf5088a3 棒4；决策 df67a9d6 / e073bdc2）。
-- 主理人拍板：任务只有两种 kind——单 agent 与 workflow；department / skill / engine / device
-- 全是属性。本迁移只立真列，84 个 task_type 不退役（零行为变化）。
--
-- 设计：
--   * 不给 DEFAULT：NULL = 未分类（只可能来自绕过 createRoutedTask 的直插），回填负责清零；
--     新建任务由 work-routing-store 按注册表写入。
--   * CHECK 用 NOT VALID 登记（毫秒级，不扫存量行），存量验证拆到 467（照 461/462、463/464）。
--   * 回填 CASE 的 workflow 名单必须与 lib/task-type-registry.js 的 WORKFLOW_KIND_TASK_TYPES
--     逐字一致（migration-466-tasks-kind-column.test.js 钉死；migrate.js 只跑 SQL，进不了 JS）。
--     判据：类型本身不产结果、只编排 ≥2 阶段/子任务 = workflow；其余一步交付 = agent。
--   * 分批 5000 行（同 461 tenant_id 手法），只动 kind IS NULL 的行——重跑是空操作（幂等）。

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kind TEXT;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_kind_check
    CHECK (kind IS NULL OR kind IN ('agent', 'workflow'))
    NOT VALID;

DO $$
DECLARE
  updated_count integer;
BEGIN
  LOOP
    UPDATE tasks SET kind = CASE
        WHEN task_type IN ('content-pipeline', 'crystallize', 'harness_initiative', 'harness_task', 'golden_path_proposal', 'workflow_run', 'project') THEN 'workflow'
        ELSE 'agent' END
    WHERE id IN (
      SELECT id FROM tasks
      WHERE kind IS NULL
      LIMIT 5000
    );
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    EXIT WHEN updated_count = 0;
  END LOOP;
END
$$;

COMMENT ON COLUMN tasks.kind IS
  '任务第一维度（决策 df67a9d6）：agent = 一个执行方一步交付；workflow = 只编排 ≥2 阶段/子任务。NULL = 未分类（直插绕过建单路径的历史行）。真身在 lib/task-type-registry.js 每个 task_type 的 kind 字段。';

INSERT INTO schema_version (version, description)
VALUES ('466', 'tasks.kind 真列（agent|workflow）+ tasks_kind_check NOT VALID + 按注册表回填')
ON CONFLICT (version) DO NOTHING;
