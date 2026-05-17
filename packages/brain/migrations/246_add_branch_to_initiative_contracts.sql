-- Migration 246: initiative_contracts 表新增 branch 列
-- 用途：Phase A GAN 批准合同所在的 git branch (e.g. cp-harness-propose-r3-xxxxxxxx)
-- 漏点：Phase B 入库 sub-task 时漏写 payload.contract_branch → harness-task-dispatch.js
--      注入 CONTRACT_BRANCH env 为空 → Generator ABORT。本列是 Initiative 级 SSOT。
-- 不加 NOT NULL（历史行已有），不加 DEFAULT（旧记录保持 NULL）。

ALTER TABLE initiative_contracts
  ADD COLUMN IF NOT EXISTS branch TEXT;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('246', 'Harness v6: initiative_contracts.branch 列（approved contract 的 propose branch）', NOW())
ON CONFLICT (version) DO NOTHING;
