-- Migration 374: acceptance_checks 加 detail/submitted_by 列 + 驳回任务去重唯一索引
-- Staff Hub 验收终局（决策 fc7b5dc0）Brain 内网端点扩展所需

ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS detail JSONB;
ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS submitted_by TEXT;

-- 同一个 acceptance run（按 run_key）在任意时刻最多只能有一条未终态的 [验收驳回] 任务，
-- 堵住内网 POST /results 与公网 POST /acceptance/results 并发触发 failed 转变沿时
-- 重复 INSERT 出两条驳回任务的竞态窗口。
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_acceptance_rejection_open
  ON tasks ((payload->>'acceptance_run_key'))
  WHERE status NOT IN ('completed','failed','cancelled')
    AND payload->>'acceptance_run_key' IS NOT NULL;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('374', 'acceptance_checks detail/submitted_by columns + rejection task dedup index', NOW())
ON CONFLICT (version) DO NOTHING;
