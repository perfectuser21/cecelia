-- Migration 164: 修复缺失的列（自治闭环依赖）
-- tick_history.completed_at — alertness metrics 需要
-- goals.starvation_score — goal-evaluator 排序需要

-- tick_history 可能不存在（由 tick loop 运行时创建）
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tick_history') THEN
    ALTER TABLE tick_history ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITHOUT TIME ZONE;
  END IF;
END $$;

ALTER TABLE goals ADD COLUMN IF NOT EXISTS starvation_score NUMERIC DEFAULT 0;
