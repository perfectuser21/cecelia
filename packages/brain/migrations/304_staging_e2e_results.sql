-- Migration 304: staging_e2e_results — Slice 1（阶段2：merge 后 staging 部署 + 自动 E2E）
--
-- 背景：harness 旧形态 merge=终点，E2E 验的是 PR 分支/活宿主而非真部署实例
-- （silent-success 老病根）。Slice 1 在 sub_task 合并后，独立于 langgraph（不碰 interrupt）
-- 创建 task_type='staging_e2e' Brain 任务：部署候选版本到 :5222 staging → 在真 staging 实例
-- 跑 contract E2E → verdict 落本表。
--
-- 设计：per-run verdict 独立表，不污染 tasks。pr_url 加 UNIQUE 约束做 DB 级幂等
--（防 tick 重入竞态：mergePrNode 可能因 BEHIND 重试或"已被外部合并"分支多次进入）。
-- INSERT 侧用 ON CONFLICT (pr_url) DO NOTHING。

CREATE TABLE IF NOT EXISTS staging_e2e_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             UUID REFERENCES tasks(id) ON DELETE SET NULL,
  initiative_id       VARCHAR(100),
  pr_url              TEXT NOT NULL,
  pr_branch           TEXT,
  -- verdict: pass / fail / skipped（skipped = staging 不可用优雅降级，不阻断）
  verdict             VARCHAR(16) NOT NULL DEFAULT 'pending',
  feedback            TEXT,
  -- staging_skip_reason: no_docker / no_env（来自 staging-deploy.sh STAGING_SKIP_REASON）
  staging_skip_reason VARCHAR(32),
  -- target_env: 证明 E2E 真打到 staging（皇冠断言落库证据），如 staging / staging:5222
  target_env          VARCHAR(64),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

-- DB 级幂等：同一 PR 只允许一条 staging E2E 记录
CREATE UNIQUE INDEX IF NOT EXISTS uniq_staging_e2e_results_pr_url
  ON staging_e2e_results(pr_url);

CREATE INDEX IF NOT EXISTS idx_staging_e2e_results_task
  ON staging_e2e_results(task_id);
