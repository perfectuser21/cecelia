-- Migration 306: staging_e2e_results.promote_status（Slice 2：人工放行闸 + production promote）
--
-- 背景（spec §3 Slice 2）：staging E2E PASS 后——
--   内部线(cecelia) 自动 promote → auto_promoted；
--   客户线(zenithjoy) → pending_promote（飞书通知主理人，挂起等 confirm，可挂数天）→ 主理人 confirm
--   回流 POST /api/brain/harness/promote/:resultId → promoting → promoted。
--   base_repo 缺失 → 保守 pending_promote（不误自动上线）。
--
-- pending 不碰 langgraph interrupt：promote_status 就是一行 DB 状态，无进程挂等。
-- 在已合的 304 表上 ALTER 加列（不动 304/305，migration 只一份原则）。

ALTER TABLE staging_e2e_results
  ADD COLUMN IF NOT EXISTS promote_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS promote_output TEXT,
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;

-- promote_status 取值约束：pending_promote / promoting / promoted / auto_promoted / promote_failed / n_a / NULL
ALTER TABLE staging_e2e_results
  DROP CONSTRAINT IF EXISTS staging_e2e_results_promote_status_check;
ALTER TABLE staging_e2e_results
  ADD CONSTRAINT staging_e2e_results_promote_status_check CHECK (
    promote_status IS NULL OR promote_status = ANY (ARRAY[
      'pending_promote', 'promoting', 'promoted', 'auto_promoted', 'promote_failed', 'n_a'
    ])
  );

CREATE INDEX IF NOT EXISTS idx_staging_e2e_results_promote_status
  ON staging_e2e_results(promote_status);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('306', 'staging_e2e_results.promote_status (Slice2 promote gate)', NOW())
ON CONFLICT (version) DO NOTHING;
