-- Migration 305: staging_e2e_results.pr_url 加 UNIQUE（Slice1 修正 · 决策 C）
--
-- 背景：#3425（migration 304）建了 staging_e2e_results 但 pr_url 无 UNIQUE，
-- 且 reportNode per-initiative 无去重派生。本修正改为 spec §3 的 per-merge 触发，
-- pr_url 成为每条 staging E2E 的去重键。本 migration 在已合的 304 表上 ALTER 加 UNIQUE，
-- 与 mergePrNode 建任务 NOT EXISTS + recordResult ON CONFLICT 一起构成 DB 级幂等。
--
-- 注：304 已合入 main，不修改 304 文件；新约束用新编号 305（migration 只一份原则）。
-- Postgres UNIQUE 允许多个 NULL（视为互异），历史 304 期可能写入的 NULL pr_url 行不冲突。

ALTER TABLE staging_e2e_results
  DROP CONSTRAINT IF EXISTS uniq_staging_e2e_results_pr_url;

ALTER TABLE staging_e2e_results
  ADD CONSTRAINT uniq_staging_e2e_results_pr_url UNIQUE (pr_url);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('305', 'staging_e2e_results.pr_url UNIQUE (Slice1 per-merge idempotency)', NOW())
ON CONFLICT (version) DO NOTHING;
