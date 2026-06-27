-- 308_staging_e2e_tested_sha.sql
-- Slice9: staging_e2e_results 加 tested_sha，锚定 staging 实测的 git SHA。
-- promote 时比对 tested_sha == 当前 main HEAD，防 SHA 漂移：run 在飞期间别的 PR merge 致
-- staging 测的是旧 SHA，但 promote 会部署新 main → 上了没经 staging 验证的代码。
ALTER TABLE staging_e2e_results ADD COLUMN IF NOT EXISTS tested_sha TEXT;
