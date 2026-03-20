-- Migration 164: 修复缺失的列（自治闭环依赖）
-- tick_history.completed_at — alertness metrics 需要
-- goals.starvation_score — goal-evaluator 排序需要

ALTER TABLE tick_history ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS starvation_score NUMERIC DEFAULT 0;
