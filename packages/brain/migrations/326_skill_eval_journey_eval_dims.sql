-- Migration 326: Skill Evaluator 补充字段（journey_id + 评估模型 + 六维度数据 + 版本链）
-- Sprint: skill-eval-full-4page
-- 前置：migration 325 已添加 area/ability/wizard_* 字段
-- 本 migration 仅补充未在 325 中添加的字段

ALTER TABLE skill_evals
  ADD COLUMN IF NOT EXISTS journey_id TEXT,
  ADD COLUMN IF NOT EXISTS eval_model TEXT,
  ADD COLUMN IF NOT EXISTS eval_dimensions JSONB,
  ADD COLUMN IF NOT EXISTS version_of UUID REFERENCES skill_evals(id);

-- journey_id: 关联 ZenithJoy 的 journey（业务线）ID，用于技能库按线分组
-- eval_model: 评估时使用的模型（例如 claude-sonnet-4-6）
-- eval_dimensions: 六维度结构化数据快照（与 report_data.dimensions 冗余，便于直接聚合查询）
-- version_of: 指向同一 skill 的前一版本，构建改进曲线

CREATE INDEX IF NOT EXISTS skill_evals_journey_id_idx ON skill_evals(journey_id);
CREATE INDEX IF NOT EXISTS skill_evals_version_of_idx ON skill_evals(version_of);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('326', 'skill_eval: journey_id, eval_model, eval_dimensions, version_of (improvement curve)', NOW())
ON CONFLICT (version) DO NOTHING;
