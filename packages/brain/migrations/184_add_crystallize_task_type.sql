-- Migration 184: 替换 codex_playwright → crystallize task type
--
-- 背景：
--   codex_playwright 是2步原型（探索+验证），缺少 Scope 和 Register 阶段。
--   crystallize 是完整4步流水线：Scope → Forge → Verify → Register。
--
-- 变更：
--   - 删除 codex_playwright
--   - 新增 crystallize（编排入口）+ 4个子类型（scope/forge/verify/register）
--   - 同步补齐 content-pipeline 和 okr 相关 task_type（之前已在代码层使用但未入约束）

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type = ANY (ARRAY[
    -- 基础类型
    'dev', 'review', 'talk', 'data', 'research',
    'exploratory', 'explore', 'knowledge',
    'qa', 'audit', 'decomp_review',
    -- Codex 类型（codex_playwright 已移除）
    'codex_qa', 'codex_dev', 'codex_test_gen', 'pr_review',
    -- 系统类型
    'code_review', 'initiative_plan', 'initiative_verify', 'initiative_execute',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced',
    'architecture_design', 'architecture_scan', 'arch_review',
    'strategy_session', 'intent_expand', 'cto_review',
    -- Pipeline v2 Gate 类型
    'spec_review', 'code_review_gate', 'prd_review', 'initiative_review',
    -- Scope 层飞轮
    'scope_plan', 'project_plan',
    -- OKR 新表飞轮
    'okr_initiative_plan', 'okr_scope_plan', 'okr_project_plan',
    -- 内容工厂 Pipeline
    'content-pipeline', 'content-research', 'content-generate',
    'content-review', 'content-export', 'content_publish',
    -- 救援类型
    'pipeline_rescue',
    -- crystallize 能力蒸馏流水线（新增）
    'crystallize', 'crystallize_scope', 'crystallize_forge',
    'crystallize_verify', 'crystallize_register'
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '184',
  'crystallize task type: 替代 codex_playwright，新增 crystallize 及4个子类型，补齐 content-pipeline 和 okr 类型',
  NOW()
)
ON CONFLICT (version) DO NOTHING;
