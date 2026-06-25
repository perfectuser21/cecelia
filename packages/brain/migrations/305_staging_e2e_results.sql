-- Migration 305: staging_e2e_results 表 —— 阶段2 Slice1 verdict 落库
-- 背景：staging_e2e 任务在真 staging 实例（:5222）跑完 contract E2E 后，
--       把 verdict（PASS/FAIL/SKIP/ERROR）+ 部署状态 + 失败场景明细落库。
--       Slice2/3（人工放行 promote / report）会读这张表，本 Slice 只负责写。
-- 设计：
--   - 不加 FK 到 initiative_contracts（合同可能被 supersede / 清理，verdict 需独立留存）。
--   - sub_task_id 用 TEXT（langgraph 子任务 id 不保证是 tasks 表的 uuid 行）。
--   - failed_scenarios / passed_scenarios / detail 用 JSONB 直接存 runFinalE2E 结果结构。

CREATE TABLE IF NOT EXISTS staging_e2e_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id    UUID NOT NULL,
  sub_task_id      TEXT,
  task_id          UUID,                          -- 触发本次验收的 staging_e2e Brain 任务 id
  verdict          TEXT NOT NULL
                     CHECK (verdict IN ('PASS', 'FAIL', 'SKIP', 'ERROR')),
  deploy_status    TEXT,                          -- success / skipped / failed
  skip_reason      TEXT,                          -- no_docker / no_env / no_contract / ...
  staging_port     INTEGER NOT NULL DEFAULT 5222,
  pr_url           TEXT,
  failed_scenarios JSONB NOT NULL DEFAULT '[]'::jsonb,
  passed_scenarios JSONB NOT NULL DEFAULT '[]'::jsonb,
  detail           JSONB,                         -- 完整 runFinalE2E 结果（bootstrap/teardown/output）
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 按 initiative 取最近一次 staging E2E verdict（Slice2 promote 决策 + Dashboard 展示）
CREATE INDEX IF NOT EXISTS idx_staging_e2e_results_initiative
  ON staging_e2e_results(initiative_id, created_at DESC);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('305', 'staging_e2e_results 表（merge 后 staging E2E verdict 落库）', NOW())
ON CONFLICT (version) DO NOTHING;
