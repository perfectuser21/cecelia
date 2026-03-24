-- Migration 185: DROP 旧 OKR 表（goals / projects / project_kr_links）
-- 前提：所有生产代码中的旧表引用已在 PR12 中清除
--
-- 执行顺序（避免 FK 冲突）：
-- 1. 迁移 goal_evaluations.goal_id FK：goals → key_results
-- 2. DROP TABLE project_kr_links CASCADE
-- 3. DROP TABLE goal_evaluations（现在 FK 已改为 key_results，可单独控制）
-- 4. DROP TABLE goals CASCADE（自动删除所有引用 goals 的 FK 约束）
-- 5. DROP TABLE projects CASCADE（自动删除所有引用 projects 的 FK 约束）

-- Step 1: 迁移 goal_evaluations.goal_id FK 从 goals → key_results
-- 注意：goals.id 与 key_results.id UUID 相同（迁移时复用了相同 UUID）
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  -- 查找 goal_evaluations.goal_id 的 FK 约束名
  SELECT conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
  WHERE t.relname = 'goal_evaluations'
    AND a.attname = 'goal_id'
    AND c.contype = 'f';

  IF v_constraint_name IS NOT NULL THEN
    -- 删除旧 FK（指向 goals）
    EXECUTE format('ALTER TABLE goal_evaluations DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE '已删除 goal_evaluations FK: %', v_constraint_name;

    -- 添加新 FK（指向 key_results），不强制检查（历史数据可能 UUID 已不存在）
    ALTER TABLE goal_evaluations
      ADD CONSTRAINT goal_evaluations_goal_id_fkey
      FOREIGN KEY (goal_id) REFERENCES key_results(id) ON DELETE CASCADE
      NOT VALID;

    -- 验证已有数据（可选，有违约数据时只警告不报错）
    BEGIN
      ALTER TABLE goal_evaluations VALIDATE CONSTRAINT goal_evaluations_goal_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'goal_evaluations FK 验证部分失败（历史孤立数据）：%', SQLERRM;
    END;

    RAISE NOTICE 'goal_evaluations.goal_id FK 已迁移至 key_results';
  ELSE
    RAISE NOTICE 'goal_evaluations 无 goal_id FK（可能已删除或未创建），跳过';
  END IF;
END $$;

-- Step 2: DROP project_kr_links（已无代码引用）
DROP TABLE IF EXISTS project_kr_links CASCADE;

-- Step 3: DROP goals CASCADE（自动级联删除所有 REFERENCES goals 的外键约束）
-- 受影响的表：features.goal_id、tasks.goal_id、goal_evaluations.goal_id（已迁移）
-- recurring_tasks.goal_id、reflections.source_goal_id 等
-- CASCADE 只删 FK 约束，不删对应的列，列中数据保留
DROP TABLE IF EXISTS goals CASCADE;

-- Step 4: DROP projects CASCADE（自动级联删除所有 REFERENCES projects 的外键约束）
-- 受影响的表：features.project_id、tasks.project_id、daily_logs.project_id
-- reflections.project_id、project_kr_links（已 DROP）等
DROP TABLE IF EXISTS projects CASCADE;

-- 记录迁移
INSERT INTO schema_version (version, description, applied_at)
VALUES ('185', 'DROP 旧 OKR 表：project_kr_links / goals / projects（所有代码引用已清除）', now())
ON CONFLICT (version) DO NOTHING;
