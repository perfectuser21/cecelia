-- Migration 008: Publishing System Tables
-- Created: 2026-02-06
-- Description: Add tables for unified publishing engine

-- Publishing tasks table
CREATE TABLE IF NOT EXISTS publishing_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(50) NOT NULL,
  content_type VARCHAR(20) NOT NULL,
  content JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT publishing_tasks_status_check
    CHECK (status IN ('pending', 'scheduled', 'publishing', 'completed', 'failed', 'cancelled')),
  CONSTRAINT publishing_tasks_content_type_check
    CHECK (content_type IN ('text', 'image', 'video'))
);

-- Indexes for publishing_tasks
CREATE INDEX IF NOT EXISTS idx_publishing_tasks_status_scheduled
  ON publishing_tasks(status, scheduled_at)
  WHERE scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_publishing_tasks_platform_status
  ON publishing_tasks(platform, status);

CREATE INDEX IF NOT EXISTS idx_publishing_tasks_created_at
  ON publishing_tasks(created_at DESC);

-- Publishing records table
CREATE TABLE IF NOT EXISTS publishing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES publishing_tasks(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  platform_response JSONB,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for publishing_records
CREATE INDEX IF NOT EXISTS idx_publishing_records_task_id
  ON publishing_records(task_id);

CREATE INDEX IF NOT EXISTS idx_publishing_records_published_at
  ON publishing_records(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_publishing_records_platform_success
  ON publishing_records(platform, success);

-- Publishing credentials table
CREATE TABLE IF NOT EXISTS publishing_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(50) NOT NULL,
  account_name VARCHAR(100) NOT NULL,
  credentials JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT publishing_credentials_unique_platform_account
    UNIQUE (platform, account_name)
);

-- Indexes for publishing_credentials
CREATE INDEX IF NOT EXISTS idx_publishing_credentials_platform_active
  ON publishing_credentials(platform, is_active)
  WHERE is_active = true;

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION update_publishing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS publishing_tasks_updated_at ON publishing_tasks;
CREATE TRIGGER publishing_tasks_updated_at
  BEFORE UPDATE ON publishing_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_publishing_updated_at();

DROP TRIGGER IF EXISTS publishing_credentials_updated_at ON publishing_credentials;
CREATE TRIGGER publishing_credentials_updated_at
  BEFORE UPDATE ON publishing_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_publishing_updated_at();

-- Comments
COMMENT ON TABLE publishing_tasks IS 'Publishing tasks for unified publishing engine';
COMMENT ON TABLE publishing_records IS 'Historical records of publishing attempts';
COMMENT ON TABLE publishing_credentials IS 'Encrypted credentials for publishing platforms';
