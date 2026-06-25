-- Migration 307: staging_e2e_results.promoted_by（Slice 3：report 补全放行人）
--
-- 背景（spec §3 Slice 3）：report 后移到 production promote 完成后，内容补全"放行人"。
-- 内部线 auto-promote → promoted_by='auto'；客户线 confirm → promoted_by=接口入参（默认 'owner'）。
-- 在已合表上 ALTER 加列（不动 304/305/306，migration 只一份原则）。

ALTER TABLE staging_e2e_results
  ADD COLUMN IF NOT EXISTS promoted_by VARCHAR(64);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('307', 'staging_e2e_results.promoted_by (Slice3 report 放行人)', NOW())
ON CONFLICT (version) DO NOTHING;
