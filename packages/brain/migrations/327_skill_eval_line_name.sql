-- Migration 327: Skill Evaluator 补充 line_name 字段（三级归属中间层）
-- Sprint: skill-eval-full-4page
-- 前置：migration 326 已添加 journey_id/eval_model/eval_dimensions/version_of
-- 背景：migration 325 添加了 area/ability 但遗漏了 area>line>ability 三级归属中的 line_name，
--       导致 routes/eval.js upload 端点 INSERT 报 "column line_name does not exist"

ALTER TABLE skill_evals
  ADD COLUMN IF NOT EXISTS line_name TEXT;

-- line_name: 三级归属中的业务线名称（如 "Line 04 私域AI接管"），位于 area 和 ability 之间
CREATE INDEX IF NOT EXISTS skill_evals_line_name_idx ON skill_evals(line_name);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('327', 'skill_eval: line_name (三级归属业务线，325 遗漏补充)', NOW())
ON CONFLICT (version) DO NOTHING;
