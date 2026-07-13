-- 319_skill_eval_report_data.sql
-- 加结构化报告数据列，供报告渲染器读取。向后兼容（可空）。
ALTER TABLE skill_evals ADD COLUMN IF NOT EXISTS report_data jsonb;
