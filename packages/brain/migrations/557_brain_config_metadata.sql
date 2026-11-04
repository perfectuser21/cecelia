-- 配置审计真身：learning 与 factory commander 共用；保留现有值及已有审计。
ALTER TABLE brain_config ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
