-- Migration 325: Skill Evaluator 三级归属 + 梳理向导字段
-- Sprint: skill-eval-full-4page
-- 前置：migration 324
-- 后继：migration 326 补充 journey_id/eval_model/eval_dimensions/version_of

ALTER TABLE skill_evals
  ADD COLUMN IF NOT EXISTS area TEXT,
  ADD COLUMN IF NOT EXISTS ability TEXT,
  ADD COLUMN IF NOT EXISTS wizard_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS wizard_questions JSONB,
  ADD COLUMN IF NOT EXISTS wizard_answers JSONB;

-- wizard_status 合法值：none / generating / ready / answered / skipped
CREATE INDEX IF NOT EXISTS skill_evals_wizard_status_idx ON skill_evals(wizard_status);
CREATE INDEX IF NOT EXISTS skill_evals_area_ability_idx ON skill_evals(area, ability);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('325', 'skill_eval: area, ability, wizard_status, wizard_questions, wizard_answers', NOW())
ON CONFLICT (version) DO NOTHING;
