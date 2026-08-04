-- Migration 383: 案卷式 GAN 收敛机制的数据模型（决策 ba33fc68 / c953a263）。
--
-- 背景：GAN Proposer/Reviewer 跨轮对话依赖 provider session resume（PR-C），
-- 但 session 可能丢失/降级；"案卷"落库为 SSOT——每轮 reviewer/proposer 的
-- rubric 分数、blocker 台账、完整反馈原文都追加一行，session 丢失时读案卷
-- 降级为等价上下文，而不是纯失忆重来。
--
-- append-only：不允许 UPDATE 改写历史行（blocker 生命周期从行序推导，
-- 例如 reviewer 在 round N 开 R2-1，proposer 在 round N+1 声明 closure，
-- reviewer 在 round N+1 再次确认/重开——全部是新行，不回改旧行）。
--
-- UNIQUE(run_id, round, author_role)：同一轮同一角色只落一行（callback
-- 重试幂等靠这个约束 + ON CONFLICT DO NOTHING，不靠应用层去重）。

CREATE TABLE IF NOT EXISTS gan_case_file (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  round INTEGER NOT NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('proposer','reviewer')),
  attempt_id UUID NOT NULL,
  contract_sha TEXT,
  rubric_scores JSONB,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  feedback_md TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, round, author_role)
);

CREATE INDEX IF NOT EXISTS idx_gan_case_file_run
  ON gan_case_file (run_id, round);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('383', 'Create gan_case_file append-only table for case-file GAN convergence', NOW())
ON CONFLICT (version) DO NOTHING;
