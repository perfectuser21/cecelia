-- Migration 470: skill_registry 承载 task_type→skill 运行时绑定（链 bf5088a3 棒7，任务 9917a588，决策 105a5868）
--
-- 病根：executor.getSkillForTaskType 只读硬编码 EXECUTOR_SKILL_MAP，skill_registry 只用于展示对账（账实分叉）。
-- 本迁移只加两列并把硬编码一次性灌进账本；执行侧改读账本见 lib/skill-binding-registry.js。
--   task_types        该 skill 承接的 task_type 名单
--   dispatch_command  派发命令原文，缺省 '/' || name（带参数命令如 '/review init' 用）
-- 回填是幂等 UPSERT：task_types 取并集、dispatch_command 只在原值为空时写，不覆盖已有行的其它列。
-- research（硬编码为空串，刻意不挂 skill）不入账。清单与 EXECUTOR_SKILL_MAP 逐项一致由
-- __tests__/migration-470-skill-registry-bindings.test.js 守卫。

ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS task_types TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS dispatch_command TEXT;

CREATE INDEX IF NOT EXISTS idx_skill_registry_task_types ON skill_registry USING GIN (task_types);

INSERT INTO skill_registry (name, description, status, dispatch_command, task_types)
SELECT v.name,
       'task_type 绑定回填（迁移 470，来源 executor 硬编码 EXECUTOR_SKILL_MAP）',
       'active',
       v.cmd,
       v.types
FROM (VALUES
  ('dev', '/dev', ARRAY['dev', 'initiative_execute', 'content_publish', 'pipeline_rescue']),
  ('code-review', '/code-review', ARRAY['review', 'code_review', 'qa', 'audit']),
  ('review', '/review init', ARRAY['qa_init']),
  ('talk', '/talk', ARRAY['talk']),
  ('repo-lead', '/repo-lead heartbeat', ARRAY['dept_heartbeat']),
  ('ci-patrol', '/ci-patrol', ARRAY['ci_patrol']),
  ('decomp', '/decomp', ARRAY['initiative_plan', 'scope_plan', 'project_plan']),
  ('architect', '/architect', ARRAY['initiative_verify', 'architecture_design']),
  ('decomp-check', '/decomp-check', ARRAY['decomp_review']),
  ('plan', '/plan', ARRAY['suggestion_plan']),
  ('strategy-session', '/strategy-session', ARRAY['strategy_session']),
  ('content-creator', '/content-creator', ARRAY['content-pipeline', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-review', 'content-export']),
  ('notebooklm', '/notebooklm', ARRAY['content-research']),
  ('intent-expand', '/intent-expand', ARRAY['intent_expand']),
  ('prd-review', '/prd-review', ARRAY['prd_review']),
  ('spec-review', '/spec-review', ARRAY['spec_review']),
  ('code-review-gate', '/code-review-gate', ARRAY['code_review_gate']),
  ('initiative-review', '/initiative-review', ARRAY['initiative_review']),
  ('codex-test-gen', '/codex-test-gen', ARRAY['codex_test_gen']),
  ('media-scraping', '/media-scraping', ARRAY['platform_scraper']),
  ('line-strategist', '/line-strategist', ARRAY['strategist_decision'])

) AS v(name, cmd, types)
ON CONFLICT (name) DO UPDATE
  SET task_types = ARRAY(
        SELECT DISTINCT x FROM unnest(skill_registry.task_types || EXCLUDED.task_types) AS x ORDER BY x),
      dispatch_command = COALESCE(skill_registry.dispatch_command, EXCLUDED.dispatch_command);

INSERT INTO schema_version (version, description)
VALUES ('470', 'skill_registry.task_types/dispatch_command：task_type→skill 运行时绑定 + 回填 EXECUTOR_SKILL_MAP')
ON CONFLICT (version) DO NOTHING;
