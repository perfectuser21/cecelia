-- CI Diagnosis Logs Table
-- Stores CI failure diagnosis and fix attempts
-- Version: 001

CREATE TABLE IF NOT EXISTS ci_diagnosis_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id BIGINT,
    repository VARCHAR(255) NOT NULL,
    branch VARCHAR(255),
    commit_sha VARCHAR(40),
    failure_type VARCHAR(50) NOT NULL, -- test_failure, type_error, lint_error, missing_dependency, unknown
    is_auto_fixable BOOLEAN DEFAULT false,
    fix_attempted BOOLEAN DEFAULT false,
    fix_result TEXT, -- success, failed, skipped
    fix_details TEXT,
    diagnosed_at TIMESTAMPTZ DEFAULT NOW(),
    fixed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ci_diagnosis_logs_failure_type ON ci_diagnosis_logs(failure_type);
CREATE INDEX IF NOT EXISTS idx_ci_diagnosis_logs_repository ON ci_diagnosis_logs(repository);
CREATE INDEX IF NOT EXISTS idx_ci_diagnosis_logs_diagnosed_at ON ci_diagnosis_logs(diagnosed_at);

-- Record schema version
INSERT INTO schema_version (version, description)
VALUES ('001', 'ci_diagnosis_logs_table')
ON CONFLICT (version) DO NOTHING;
