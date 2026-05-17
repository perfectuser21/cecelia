---
id: kr22-publish-engine-schema
version: 1.0.0
created: 2026-02-06
updated: 2026-02-06
changelog:
  - 1.0.0: Initial database schema for KR2.2 Unified Publish Engine
---

# KR2.2 Publish Engine - Database Schema

> **Purpose**: Define the database schema for the Unified Publish Engine
> **Target Database**: PostgreSQL 15+
> **Target Project**: zenithjoy-autopilot

## Overview

This document contains the complete database schema for the KR2.2 Unified Publish Engine, including:
1. Table definitions (publish_jobs, publish_records, platform_credentials)
2. Indexes for query optimization
3. Foreign keys and constraints
4. Migration script (forward)
5. Rollback script (backward)

## Schema Design Principles

1. **UUID Primary Keys**: For distributed system compatibility and security
2. **JSONB for Flexibility**: Metadata and credentials use JSONB for schema evolution
3. **Proper Indexing**: Optimize for common query patterns (status lookups, time-based queries)
4. **Timestamp Tracking**: created_at and updated_at for audit trail
5. **Soft References**: platform_credentials use string platform names, not hard foreign keys (platforms can be added dynamically)

---

## Table Definitions

### Table 1: publish_jobs

**Purpose**: Stores high-level publish job requests (one job can target multiple platforms)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique job identifier |
| content_id | UUID | NOT NULL | Reference to content table (assumed to exist in zenithjoy) |
| platforms | TEXT[] | NOT NULL, CHECK (array_length(platforms, 1) > 0) | Target platforms (e.g., ['douyin', 'xiaohongshu']) |
| status | TEXT | NOT NULL, DEFAULT 'pending' | Job status: pending/running/success/failed/partial |
| priority | INTEGER | DEFAULT 0 | Priority (0=normal, 1=high, 2=urgent) |
| scheduled_at | TIMESTAMPTZ | NULL | Scheduled publish time (NULL = publish immediately) |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Job creation time |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update time |
| metadata | JSONB | DEFAULT '{}'::jsonb | Additional job metadata (user_id, campaign_id, etc.) |

**Constraints**:
- `status` must be one of: pending, running, success, failed, partial
- `platforms` array cannot be empty
- `scheduled_at` if set, must be in the future (can be enforced in application logic)

**Indexes**:
- `idx_publish_jobs_status`: For filtering by status (pending jobs)
- `idx_publish_jobs_scheduled`: For scheduled jobs poller
- `idx_publish_jobs_created_at`: For time-based queries

---

### Table 2: publish_records

**Purpose**: Stores platform-specific publish results (one record per platform per job)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique record identifier |
| job_id | UUID | NOT NULL, REFERENCES publish_jobs(id) ON DELETE CASCADE | Parent job |
| platform | TEXT | NOT NULL | Platform name (e.g., 'douyin', 'xiaohongshu') |
| status | TEXT | NOT NULL, DEFAULT 'pending' | Record status: pending/success/failed |
| retry_count | INTEGER | DEFAULT 0, CHECK (retry_count >= 0) | Current retry attempt count |
| max_retries | INTEGER | DEFAULT 3, CHECK (max_retries >= 0) | Maximum retry attempts allowed |
| error_type | TEXT | NULL | Error classification: network_timeout/rate_limit/auth_failed/content_rejected/platform_error |
| error_message | TEXT | NULL | Detailed error message from platform API |
| platform_post_id | TEXT | NULL | Platform-returned post ID (if successful) |
| platform_url | TEXT | NULL | Public URL of published content |
| published_at | TIMESTAMPTZ | NULL | Actual publish time (when status became 'success') |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update time |
| metadata | JSONB | DEFAULT '{}'::jsonb | Platform-specific metadata (thumbnail_url, view_count, etc.) |

**Constraints**:
- `status` must be one of: pending, success, failed
- `error_type` must be one of: network_timeout, rate_limit, auth_failed, content_rejected, platform_error (if not NULL)
- `retry_count` <= `max_retries` (enforced in application logic)

**Indexes**:
- `idx_publish_records_job_id`: For joining with publish_jobs
- `idx_publish_records_status`: For filtering pending/failed records
- `idx_publish_records_platform`: For platform-specific queries

**Foreign Keys**:
- `job_id` → `publish_jobs(id)` ON DELETE CASCADE (delete records when job is deleted)

---

### Table 3: platform_credentials

**Purpose**: Stores platform authentication credentials (tokens, cookies, OAuth)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique credential identifier |
| platform | TEXT | NOT NULL | Platform name (e.g., 'douyin', 'xiaohongshu') |
| account_name | TEXT | NOT NULL | Human-readable account identifier (e.g., 'zenithjoy_official') |
| credential_type | TEXT | NOT NULL | Credential type: token/cookie/oauth |
| credentials | JSONB | NOT NULL | Encrypted credentials (structure depends on credential_type) |
| expires_at | TIMESTAMPTZ | NULL | Credential expiration time (NULL = never expires) |
| status | TEXT | DEFAULT 'active' | Credential status: active/expired/invalid |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Credential creation time |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update time |
| metadata | JSONB | DEFAULT '{}'::jsonb | Additional metadata (last_used_at, refresh_token, etc.) |

**Constraints**:
- `UNIQUE(platform, account_name)`: One credential per account per platform
- `credential_type` must be one of: token, cookie, oauth
- `status` must be one of: active, expired, invalid

**Indexes**:
- `idx_platform_credentials_platform_account`: For looking up credentials by platform and account
- `idx_platform_credentials_status`: For filtering active credentials
- `idx_platform_credentials_expires_at`: For credential expiration monitoring

**Unique Constraints**:
- `UNIQUE(platform, account_name)`: Prevents duplicate credentials

**Credentials JSONB Structure Examples**:

```json
// Token type
{
  "access_token": "encrypted_token_value",
  "token_type": "Bearer"
}

// Cookie type
{
  "cookies": {
    "sessionid": "encrypted_cookie_value",
    "csrftoken": "encrypted_csrf_value"
  }
}

// OAuth type
{
  "access_token": "encrypted_access_token",
  "refresh_token": "encrypted_refresh_token",
  "expires_in": 3600
}
```

---

## Relationships

```
publish_jobs (1) ──── (N) publish_records
                         ↓
                    (platform: TEXT)
                         ↓
                    platform_credentials (lookup by platform + account_name)
```

**Note**: platform_credentials is not directly foreign-keyed to publish_records to allow dynamic platform addition without schema changes.

---

## Migration Script (Forward)

**File**: `zenithjoy-autopilot/database/migrations/20260206_create_publish_engine_tables.sql`

```sql
-- ===========================================================================
-- Migration: Create Publish Engine Tables for KR2.2
-- Author: Claude (Caramel 焦糖)
-- Date: 2026-02-06
-- Description: Creates publish_jobs, publish_records, and platform_credentials tables
-- ===========================================================================

BEGIN;

-- =========================
-- Table: publish_jobs
-- =========================

CREATE TABLE IF NOT EXISTS publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL,
  platforms TEXT[] NOT NULL CHECK (array_length(platforms, 1) > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'partial')),
  priority INTEGER DEFAULT 0 CHECK (priority >= 0 AND priority <= 2),
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

COMMENT ON TABLE publish_jobs IS 'High-level publish job requests (one job can target multiple platforms)';
COMMENT ON COLUMN publish_jobs.content_id IS 'Reference to content table (assumed to exist in zenithjoy)';
COMMENT ON COLUMN publish_jobs.platforms IS 'Array of target platform names (e.g., [''douyin'', ''xiaohongshu''])';
COMMENT ON COLUMN publish_jobs.status IS 'Job status: pending/running/success/failed/partial';
COMMENT ON COLUMN publish_jobs.priority IS 'Priority: 0=normal, 1=high, 2=urgent';
COMMENT ON COLUMN publish_jobs.scheduled_at IS 'Scheduled publish time (NULL = publish immediately)';

-- =========================
-- Table: publish_records
-- =========================

CREATE TABLE IF NOT EXISTS publish_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES publish_jobs(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  retry_count INTEGER DEFAULT 0 CHECK (retry_count >= 0),
  max_retries INTEGER DEFAULT 3 CHECK (max_retries >= 0),
  error_type TEXT CHECK (error_type IN ('network_timeout', 'rate_limit', 'auth_failed', 'content_rejected', 'platform_error') OR error_type IS NULL),
  error_message TEXT,
  platform_post_id TEXT,
  platform_url TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

COMMENT ON TABLE publish_records IS 'Platform-specific publish results (one record per platform per job)';
COMMENT ON COLUMN publish_records.job_id IS 'Reference to parent publish_jobs record';
COMMENT ON COLUMN publish_records.platform IS 'Platform name (e.g., ''douyin'', ''xiaohongshu'')';
COMMENT ON COLUMN publish_records.retry_count IS 'Current retry attempt count';
COMMENT ON COLUMN publish_records.error_type IS 'Error classification for retry decisions';
COMMENT ON COLUMN publish_records.platform_post_id IS 'Platform-returned post ID (if successful)';

-- =========================
-- Table: platform_credentials
-- =========================

CREATE TABLE IF NOT EXISTS platform_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  account_name TEXT NOT NULL,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('token', 'cookie', 'oauth')),
  credentials JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'invalid')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  UNIQUE(platform, account_name)
);

COMMENT ON TABLE platform_credentials IS 'Platform authentication credentials (tokens, cookies, OAuth)';
COMMENT ON COLUMN platform_credentials.platform IS 'Platform name (e.g., ''douyin'', ''xiaohongshu'')';
COMMENT ON COLUMN platform_credentials.account_name IS 'Human-readable account identifier (e.g., ''zenithjoy_official'')';
COMMENT ON COLUMN platform_credentials.credential_type IS 'Credential type: token/cookie/oauth';
COMMENT ON COLUMN platform_credentials.credentials IS 'Encrypted credentials (JSONB structure depends on credential_type)';

-- =========================
-- Indexes
-- =========================

-- publish_jobs indexes
CREATE INDEX IF NOT EXISTS idx_publish_jobs_status ON publish_jobs(status);
CREATE INDEX IF NOT EXISTS idx_publish_jobs_scheduled ON publish_jobs(scheduled_at) WHERE status = 'pending' AND scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_publish_jobs_created_at ON publish_jobs(created_at DESC);

-- publish_records indexes
CREATE INDEX IF NOT EXISTS idx_publish_records_job_id ON publish_records(job_id);
CREATE INDEX IF NOT EXISTS idx_publish_records_status ON publish_records(status);
CREATE INDEX IF NOT EXISTS idx_publish_records_platform ON publish_records(platform);
CREATE INDEX IF NOT EXISTS idx_publish_records_job_platform ON publish_records(job_id, platform);

-- platform_credentials indexes
CREATE INDEX IF NOT EXISTS idx_platform_credentials_platform_account ON platform_credentials(platform, account_name);
CREATE INDEX IF NOT EXISTS idx_platform_credentials_status ON platform_credentials(status);
CREATE INDEX IF NOT EXISTS idx_platform_credentials_expires_at ON platform_credentials(expires_at) WHERE expires_at IS NOT NULL;

-- =========================
-- Triggers (optional - for updated_at auto-update)
-- =========================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_publish_jobs_updated_at BEFORE UPDATE ON publish_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_publish_records_updated_at BEFORE UPDATE ON publish_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_platform_credentials_updated_at BEFORE UPDATE ON platform_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================
-- Verification
-- =========================

DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'publish_jobs') = 1, 'publish_jobs table not created';
  ASSERT (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'publish_records') = 1, 'publish_records table not created';
  ASSERT (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'platform_credentials') = 1, 'platform_credentials table not created';
  RAISE NOTICE 'Migration successful: All 3 tables created';
END $$;

COMMIT;

-- ===========================================================================
-- End of Migration
-- ===========================================================================
```

---

## Rollback Script (Backward)

**File**: `zenithjoy-autopilot/database/migrations/20260206_drop_publish_engine_tables.sql`

```sql
-- ===========================================================================
-- Rollback: Drop Publish Engine Tables for KR2.2
-- Author: Claude (Caramel 焦糖)
-- Date: 2026-02-06
-- Description: Drops publish_jobs, publish_records, and platform_credentials tables
-- ===========================================================================

BEGIN;

-- Drop triggers first
DROP TRIGGER IF EXISTS update_publish_jobs_updated_at ON publish_jobs;
DROP TRIGGER IF EXISTS update_publish_records_updated_at ON publish_records;
DROP TRIGGER IF EXISTS update_platform_credentials_updated_at ON platform_credentials;

-- Drop function
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop tables (CASCADE to handle foreign keys)
DROP TABLE IF EXISTS publish_records CASCADE;
DROP TABLE IF EXISTS platform_credentials CASCADE;
DROP TABLE IF EXISTS publish_jobs CASCADE;

-- Verification
DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'publish_jobs') = 0, 'publish_jobs table still exists';
  ASSERT (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'publish_records') = 0, 'publish_records table still exists';
  ASSERT (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'platform_credentials') = 0, 'platform_credentials table still exists';
  RAISE NOTICE 'Rollback successful: All tables dropped';
END $$;

COMMIT;

-- ===========================================================================
-- End of Rollback
-- ===========================================================================
```

---

## Testing the Migration

### Prerequisites

```bash
# Ensure PostgreSQL 15+ is installed
psql --version

# Create a test database
createdb test_kr22_publish_engine
```

### Forward Migration Test

```bash
# Run the migration
psql -U postgres -d test_kr22_publish_engine -f database/migrations/20260206_create_publish_engine_tables.sql

# Verify tables created
psql -U postgres -d test_kr22_publish_engine -c "\dt publish_*"
psql -U postgres -d test_kr22_publish_engine -c "\dt platform_*"

# Verify indexes
psql -U postgres -d test_kr22_publish_engine -c "\di idx_publish_*"

# Check table structure
psql -U postgres -d test_kr22_publish_engine -c "\d publish_jobs"
psql -U postgres -d test_kr22_publish_engine -c "\d publish_records"
psql -U postgres -d test_kr22_publish_engine -c "\d platform_credentials"
```

### Rollback Migration Test

```bash
# Run the rollback
psql -U postgres -d test_kr22_publish_engine -f database/migrations/20260206_drop_publish_engine_tables.sql

# Verify tables dropped
psql -U postgres -d test_kr22_publish_engine -c "\dt publish_*"
# Should return: Did not find any relation named "publish_*".
```

### Data Integrity Test

```bash
# After forward migration, insert test data
psql -U postgres -d test_kr22_publish_engine << EOF
-- Insert a test job
INSERT INTO publish_jobs (content_id, platforms, priority)
VALUES ('123e4567-e89b-12d3-a456-426614174000'::uuid, ARRAY['douyin', 'xiaohongshu'], 1);

-- Get the job ID
SELECT id FROM publish_jobs LIMIT 1;

-- Insert test records (replace JOB_ID with actual ID from above)
INSERT INTO publish_records (job_id, platform, status)
VALUES
  ('JOB_ID_HERE'::uuid, 'douyin', 'pending'),
  ('JOB_ID_HERE'::uuid, 'xiaohongshu', 'pending');

-- Verify cascade delete works
DELETE FROM publish_jobs WHERE content_id = '123e4567-e89b-12d3-a456-426614174000'::uuid;

-- Check publish_records are also deleted (should return 0)
SELECT COUNT(*) FROM publish_records;
EOF
```

---

## Query Examples

### Find all pending jobs

```sql
SELECT * FROM publish_jobs
WHERE status = 'pending'
ORDER BY priority DESC, created_at ASC;
```

### Get job status with platform breakdown

```sql
SELECT
  j.id AS job_id,
  j.status AS job_status,
  j.platforms,
  ARRAY_AGG(DISTINCT r.status) AS platform_statuses,
  COUNT(CASE WHEN r.status = 'success' THEN 1 END) AS success_count,
  COUNT(CASE WHEN r.status = 'failed' THEN 1 END) AS failed_count
FROM publish_jobs j
LEFT JOIN publish_records r ON j.id = r.job_id
WHERE j.id = 'YOUR_JOB_ID'::uuid
GROUP BY j.id;
```

### Find jobs needing retry

```sql
SELECT r.*
FROM publish_records r
WHERE r.status = 'failed'
  AND r.retry_count < r.max_retries
ORDER BY r.updated_at ASC;
```

### Get success rate by platform (last 24 hours)

```sql
SELECT
  platform,
  COUNT(*) AS total_attempts,
  COUNT(CASE WHEN status = 'success' THEN 1 END) AS successes,
  ROUND(100.0 * COUNT(CASE WHEN status = 'success' THEN 1 END) / COUNT(*), 2) AS success_rate_pct
FROM publish_records
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY platform
ORDER BY success_rate_pct DESC;
```

### Find expired credentials

```sql
SELECT * FROM platform_credentials
WHERE expires_at < NOW()
  AND status = 'active'
ORDER BY expires_at DESC;
```

---

## Schema Evolution Strategy

### Adding New Platforms

**No schema change needed!** Platform names are stored as TEXT, not enum.

```sql
-- Just insert credentials for new platform
INSERT INTO platform_credentials (platform, account_name, credential_type, credentials)
VALUES ('bilibili', 'zenithjoy_official', 'cookie', '{"cookies": {...}}'::jsonb);
```

### Adding New Error Types

**Requires ALTER TABLE** (but backward compatible):

```sql
-- Option 1: Drop and recreate CHECK constraint (allows new values)
ALTER TABLE publish_records DROP CONSTRAINT IF EXISTS publish_records_error_type_check;
ALTER TABLE publish_records ADD CONSTRAINT publish_records_error_type_check
  CHECK (error_type IN ('network_timeout', 'rate_limit', 'auth_failed', 'content_rejected', 'platform_error', 'NEW_ERROR_TYPE') OR error_type IS NULL);

-- Option 2: Remove CHECK entirely and enforce in application
ALTER TABLE publish_records DROP CONSTRAINT IF EXISTS publish_records_error_type_check;
```

### Adding New Job Statuses

Similar to error types, ALTER TABLE to update CHECK constraint.

---

## Security Considerations

### Credential Encryption

**Important**: The `credentials` JSONB column should store **encrypted** values, not plaintext.

**Recommended**: Use PostgreSQL's `pgcrypto` extension or encrypt at application layer.

```sql
-- Example with pgcrypto (application layer encryption is preferred)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Encrypt credentials before insert
INSERT INTO platform_credentials (platform, account_name, credential_type, credentials)
VALUES (
  'douyin',
  'zenithjoy_official',
  'token',
  pgp_sym_encrypt('{"access_token": "secret_value"}'::text, 'encryption_key')::jsonb
);

-- Decrypt credentials on read
SELECT
  platform,
  account_name,
  pgp_sym_decrypt(credentials::text::bytea, 'encryption_key')::jsonb AS decrypted_credentials
FROM platform_credentials
WHERE platform = 'douyin';
```

**Better approach**: Encrypt/decrypt in application code (Node.js crypto module) and store encrypted strings in JSONB.

### Access Control

```sql
-- Create a dedicated role for publish engine
CREATE ROLE publish_engine_user WITH LOGIN PASSWORD 'secure_password';

-- Grant only necessary permissions
GRANT SELECT, INSERT, UPDATE ON publish_jobs TO publish_engine_user;
GRANT SELECT, INSERT, UPDATE ON publish_records TO publish_engine_user;
GRANT SELECT ON platform_credentials TO publish_engine_user; -- Read-only for credentials

-- Revoke DELETE permission (soft deletes preferred, or admin-only)
REVOKE DELETE ON publish_jobs FROM publish_engine_user;
REVOKE DELETE ON publish_records FROM publish_engine_user;
```

---

## Performance Considerations

### Index Usage Analysis

```sql
-- Check if indexes are being used
EXPLAIN ANALYZE SELECT * FROM publish_jobs WHERE status = 'pending';
-- Should show: Index Scan using idx_publish_jobs_status

EXPLAIN ANALYZE SELECT * FROM publish_records WHERE job_id = 'some-uuid';
-- Should show: Index Scan using idx_publish_records_job_id
```

### Partition Strategy (Future Optimization)

If the publish_records table grows very large (millions of rows), consider partitioning by created_at:

```sql
-- Example: Partition by month (requires PostgreSQL 10+)
CREATE TABLE publish_records_partitioned (
  LIKE publish_records INCLUDING ALL
) PARTITION BY RANGE (created_at);

CREATE TABLE publish_records_2026_02 PARTITION OF publish_records_partitioned
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE publish_records_2026_03 PARTITION OF publish_records_partitioned
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
-- etc.
```

---

## Maintenance

### Vacuum and Analyze

```sql
-- Run after bulk inserts/updates
VACUUM ANALYZE publish_jobs;
VACUUM ANALYZE publish_records;
VACUUM ANALYZE platform_credentials;
```

### Archive Old Records

```sql
-- Archive records older than 90 days
CREATE TABLE publish_records_archive AS
SELECT * FROM publish_records WHERE created_at < NOW() - INTERVAL '90 days';

DELETE FROM publish_records WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## Appendix: Migration Checklist

**Pre-Migration**:
- [ ] Backup production database
- [ ] Test migration on dev environment
- [ ] Test migration on staging environment
- [ ] Verify rollback script works
- [ ] Review schema with DBA (if applicable)

**Migration Execution**:
- [ ] Put application in maintenance mode (if needed)
- [ ] Run forward migration script
- [ ] Verify tables created (`\dt publish_*`)
- [ ] Verify indexes created (`\di idx_publish_*`)
- [ ] Run data integrity tests
- [ ] Resume application

**Post-Migration**:
- [ ] Monitor database performance
- [ ] Check application logs for errors
- [ ] Verify publish engine functionality
- [ ] Document any issues encountered

---

**Document Status**: ✅ Final
**Reviewed By**: Pending
**Last Updated**: 2026-02-06
**Target Environment**: zenithjoy-autopilot PostgreSQL database
