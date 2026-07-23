-- Migration 358: preview_environments 销毁终态 — 新增 cleaning/cleanup_failed 状态 + cleanup_detail
--
-- 统一销毁器（preview-destroyer.js）7 步流程需要在执行期间把状态置为 'cleaning'，
-- 若 dropdb/worktree remove 等步骤失败或安全校验（DB 名正则/realpath 逃逸）未通过，
-- 置 'cleanup_failed' 并把残留清单写入 cleanup_detail（绝不误标 inactive，见 Risks 段）。
--
-- preview_environments.status 无既有 CHECK 约束（migration 337 未加），
-- 'cleaning'/'cleanup_failed' 作为应用层新增的合法取值，本迁移不需要变更约束，
-- 只需新增 cleanup_detail 列即可承载残留清单（Additive only）。

ALTER TABLE preview_environments ADD COLUMN IF NOT EXISTS cleanup_detail JSONB;

COMMENT ON COLUMN preview_environments.cleanup_detail IS
  'destroyPreview() 终态复查残留清单（status=cleanup_failed 时非 null）：{db_dropped, worktree_removed, processes_killed, temp_files_cleared, residual: string[]}';

COMMENT ON COLUMN preview_environments.status IS
  'starting | active | cleaning | inactive | cleanup_failed — cleaning/cleanup_failed 由 preview-destroyer.js 统一销毁器写入（migration 358）';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('358', 'preview_environments cleaning/cleanup_failed states + cleanup_detail jsonb', NOW())
ON CONFLICT (version) DO NOTHING;
