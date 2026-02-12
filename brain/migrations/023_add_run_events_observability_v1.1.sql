-- Migration 023: Add run_events table for full observability (v1.1)
-- Implements unified event stream for tracing execution across all layers
--
-- v1.1 Changes (based on engineering review):
-- 1. Clarified task_id/run_id/span_id relationship with indexes
-- 2. Added executor_host, agent, attempt, reason_kind fields
-- 3. Prepared artifacts for artifact_id + proxy pattern
-- 4. Enhanced stuck detection with last_alive_span view
-- 5. Removed setInterval GC (use external scheduler instead)

-- Core run_events table
CREATE TABLE IF NOT EXISTS run_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,

    -- Trace identifiers (OpenTelemetry-compatible)
    task_id uuid REFERENCES tasks(id),       -- Business task (can be NULL for standalone runs)
    run_id uuid NOT NULL,                    -- Execution attempt ID (one task may have multiple runs)
    span_id uuid DEFAULT gen_random_uuid() NOT NULL, -- Step/span ID within this run
    parent_span_id uuid,                     -- Parent step (for nested spans)

    -- Layer & Step identification
    layer character varying(50) NOT NULL,    -- L0_orchestrator, L1_brain, L2_executor, L3_browser, L4_artifact
    step_name character varying(255) NOT NULL, -- e.g., "connect_cdp", "upload_file", "fill_title"

    -- Status & Reason
    status character varying(50) NOT NULL,   -- queued, running, blocked, retrying, success, failed, canceled
    reason_code character varying(100),      -- MISSING_FILE, SELECTOR_NOT_FOUND, AUTH_EXPIRED, TIMEOUT, etc.
    reason_kind character varying(20),       -- TRANSIENT, PERSISTENT, RESOURCE, CONFIG, UNKNOWN

    -- Execution context (v1.1: added for multi-host tracking)
    executor_host character varying(100),    -- us-vps, hk-vps, mac-mini, node-pc (hostname or IP)
    agent character varying(100),            -- Agent name: caramel, nobel, qa, audit, etc.
    region character varying(10),            -- us, hk
    attempt integer DEFAULT 1,               -- Retry attempt number (1 = first try, 2 = first retry, etc.)
    retry_count integer DEFAULT 0,           -- Total retries so far (deprecated, use attempt instead)

    -- Timestamps
    ts_start timestamp with time zone DEFAULT now(),
    ts_end timestamp with time zone,
    heartbeat_ts timestamp with time zone DEFAULT now(),

    -- Input/Output/Artifacts
    input_summary jsonb,                     -- Input parameters (sanitized, no secrets)
    output_summary jsonb,                    -- Output result (sanitized)
    artifacts jsonb,                         -- {"screenshot_id": "artifact-uuid", "log_id": "artifact-uuid"}
                                             -- v1.1: Store artifact_id instead of raw paths

    -- Metadata
    metadata jsonb,                          -- Flexible additional data

    created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE run_events IS 'Unified event stream for observability - all layers write here (v1.1)';
COMMENT ON COLUMN run_events.task_id IS 'Business task ID from tasks table (nullable - some runs may be standalone)';
COMMENT ON COLUMN run_events.run_id IS 'Execution attempt ID - one task may retry and generate multiple runs';
COMMENT ON COLUMN run_events.span_id IS 'Individual step ID within a run (OpenTelemetry span)';
COMMENT ON COLUMN run_events.layer IS 'Execution layer: L0_orchestrator, L1_brain, L2_executor, L3_browser, L4_artifact';
COMMENT ON COLUMN run_events.reason_code IS 'Enumerated failure reason for aggregation (e.g., TIMEOUT, SELECTOR_NOT_FOUND)';
COMMENT ON COLUMN run_events.reason_kind IS 'Failure category: TRANSIENT (auto-retry), PERSISTENT (manual fix), RESOURCE (scale up), CONFIG (fix config)';
COMMENT ON COLUMN run_events.executor_host IS 'Machine executing this span (hostname, IP, or machine_id)';
COMMENT ON COLUMN run_events.agent IS 'Agent name executing this span (caramel, nobel, qa, audit, etc.)';
COMMENT ON COLUMN run_events.attempt IS 'Retry attempt number (1=first try, 2=first retry, etc.)';
COMMENT ON COLUMN run_events.heartbeat_ts IS 'Last heartbeat timestamp - used to detect stuck/zombie runs';
COMMENT ON COLUMN run_events.artifacts IS 'Artifact IDs (use GET /api/brain/trace/artifacts/:id for access)';

-- Indexes for fast queries
CREATE INDEX idx_run_events_task_id ON run_events(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_run_events_run_id ON run_events(run_id);
CREATE INDEX idx_run_events_span_id ON run_events(span_id);
CREATE INDEX idx_run_events_parent_span_id ON run_events(parent_span_id) WHERE parent_span_id IS NOT NULL;
CREATE INDEX idx_run_events_layer ON run_events(layer);
CREATE INDEX idx_run_events_status ON run_events(status);
CREATE INDEX idx_run_events_reason_code ON run_events(reason_code) WHERE reason_code IS NOT NULL;
CREATE INDEX idx_run_events_reason_kind ON run_events(reason_kind) WHERE reason_kind IS NOT NULL;
CREATE INDEX idx_run_events_executor_host ON run_events(executor_host) WHERE executor_host IS NOT NULL;
CREATE INDEX idx_run_events_heartbeat ON run_events(heartbeat_ts) WHERE status = 'running';
CREATE INDEX idx_run_events_ts_start ON run_events(ts_start DESC);

-- Composite index for task → runs lookup
CREATE INDEX idx_run_events_task_run ON run_events(task_id, run_id) WHERE task_id IS NOT NULL;

-- GIN indexes for JSONB fields
CREATE INDEX idx_run_events_artifacts ON run_events USING gin(artifacts);
CREATE INDEX idx_run_events_metadata ON run_events USING gin(metadata);

-- Unique constraint: prevent duplicate span_id
CREATE UNIQUE INDEX idx_run_events_span_id_unique ON run_events(span_id);

-----------------------------------
-- VIEWS
-----------------------------------

-- View: Active runs (currently running, with last heartbeat)
CREATE OR REPLACE VIEW v_active_runs AS
SELECT
    run_id,
    task_id,
    layer,
    step_name,
    executor_host,
    agent,
    ts_start,
    heartbeat_ts,
    EXTRACT(EPOCH FROM (now() - heartbeat_ts)) AS seconds_since_heartbeat,
    CASE
        WHEN EXTRACT(EPOCH FROM (now() - heartbeat_ts)) > 300 THEN 'stuck'
        WHEN EXTRACT(EPOCH FROM (now() - heartbeat_ts)) > 120 THEN 'slow'
        ELSE 'healthy'
    END AS health_status
FROM run_events
WHERE status = 'running'
ORDER BY heartbeat_ts ASC;

-- View: Run summary (aggregated stats per run)
CREATE OR REPLACE VIEW v_run_summary AS
SELECT
    run_id,
    task_id,
    MIN(ts_start) AS run_start,
    MAX(COALESCE(ts_end, now())) AS run_end_or_now,
    COUNT(*) AS total_spans,
    COUNT(*) FILTER (WHERE status = 'success') AS success_spans,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_spans,
    COUNT(*) FILTER (WHERE status = 'running') AS running_spans,
    ARRAY_AGG(DISTINCT layer ORDER BY layer) AS layers_involved,
    ARRAY_AGG(DISTINCT executor_host ORDER BY executor_host) FILTER (WHERE executor_host IS NOT NULL) AS hosts_involved,
    MAX(heartbeat_ts) AS last_heartbeat,
    CASE
        WHEN COUNT(*) FILTER (WHERE status = 'running') > 0 THEN 'running'
        WHEN COUNT(*) FILTER (WHERE status = 'failed') > 0 THEN 'failed'
        WHEN COUNT(*) FILTER (WHERE status = 'success') = COUNT(*) THEN 'success'
        ELSE 'partial'
    END AS overall_status
FROM run_events
GROUP BY run_id, task_id;

-- View: Top failure reasons (last 24h)
CREATE OR REPLACE VIEW v_top_failure_reasons AS
SELECT
    reason_code,
    reason_kind,
    layer,
    COUNT(*) AS failure_count,
    MAX(ts_start) AS last_occurrence,
    ARRAY_AGG(DISTINCT executor_host) FILTER (WHERE executor_host IS NOT NULL) AS affected_hosts
FROM run_events
WHERE status = 'failed'
    AND reason_code IS NOT NULL
    AND ts_start > now() - interval '24 hours'
GROUP BY reason_code, reason_kind, layer
ORDER BY failure_count DESC
LIMIT 20;

-- View: Last alive span per run (v1.1: critical for stuck detection)
CREATE OR REPLACE VIEW v_run_last_alive_span AS
WITH ranked_spans AS (
    SELECT
        run_id,
        span_id,
        layer,
        step_name,
        status,
        reason_code,
        executor_host,
        ts_start,
        heartbeat_ts,
        input_summary,
        output_summary,
        artifacts,
        ROW_NUMBER() OVER (
            PARTITION BY run_id
            ORDER BY COALESCE(heartbeat_ts, ts_start) DESC
        ) AS rn
    FROM run_events
)
SELECT
    run_id,
    span_id,
    layer,
    step_name,
    status,
    reason_code,
    executor_host,
    ts_start,
    heartbeat_ts,
    input_summary,
    output_summary,
    artifacts,
    EXTRACT(EPOCH FROM (now() - COALESCE(heartbeat_ts, ts_start))) AS seconds_since_activity
FROM ranked_spans
WHERE rn = 1;

-----------------------------------
-- FUNCTIONS
-----------------------------------

-- Function: Update heartbeat (called by executing code)
CREATE OR REPLACE FUNCTION update_run_heartbeat(p_span_id uuid)
RETURNS void AS $$
BEGIN
    UPDATE run_events
    SET heartbeat_ts = now()
    WHERE span_id = p_span_id AND status = 'running';
END;
$$ LANGUAGE plpgsql;

-- Function: Detect stuck runs (no heartbeat for 5+ minutes)
-- v1.1: Enhanced to return last_alive_span details
CREATE OR REPLACE FUNCTION detect_stuck_runs()
RETURNS TABLE(
    run_id uuid,
    task_id uuid,
    last_alive_span_id uuid,
    layer text,
    step_name text,
    executor_host text,
    stuck_duration_seconds numeric,
    input_summary jsonb,
    artifacts jsonb
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        re.run_id,
        re.task_id,
        re.span_id AS last_alive_span_id,
        re.layer::text,
        re.step_name::text,
        re.executor_host::text,
        re.seconds_since_activity AS stuck_duration_seconds,
        re.input_summary,
        re.artifacts
    FROM v_run_last_alive_span re
    WHERE re.seconds_since_activity > 300  -- 5 minutes
        AND re.status = 'running'
    ORDER BY re.seconds_since_activity DESC;
END;
$$ LANGUAGE plpgsql;

-- Function: GC cleanup orphaned runs (v1.1: designed for external scheduler)
-- Usage: node scripts/gc-runs.js (called by cron/systemd/n8n)
CREATE OR REPLACE FUNCTION cleanup_expired_runs(p_days_threshold integer DEFAULT 7)
RETURNS TABLE(
    run_id uuid,
    task_id uuid,
    total_spans integer,
    run_start timestamp with time zone,
    run_end timestamp with time zone
) AS $$
BEGIN
    -- Advisory lock to prevent concurrent GC (distributed lock pattern)
    IF NOT pg_try_advisory_lock(hashtext('cleanup_expired_runs')) THEN
        RAISE NOTICE 'Another GC process is running, skipping...';
        RETURN;
    END IF;

    BEGIN
        RETURN QUERY
        WITH expired_runs AS (
            SELECT
                rs.run_id,
                rs.task_id,
                rs.total_spans,
                rs.run_start,
                rs.run_end_or_now AS run_end
            FROM v_run_summary rs
            WHERE rs.overall_status IN ('success', 'failed', 'partial')
                AND rs.run_end_or_now < now() - (p_days_threshold || ' days')::interval
        )
        SELECT * FROM expired_runs;

        -- Mark as GC'd (don't delete, for audit trail)
        UPDATE run_events
        SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{gc_at}',
            to_jsonb(now())
        )
        WHERE run_id IN (
            SELECT er.run_id FROM expired_runs er
        );

    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_advisory_unlock(hashtext('cleanup_expired_runs'));
        RAISE;
    END;

    -- Release advisory lock
    PERFORM pg_advisory_unlock(hashtext('cleanup_expired_runs'));
END;
$$ LANGUAGE plpgsql;

-----------------------------------
-- ARTIFACTS TABLE (v1.1: separate storage for artifact metadata)
-----------------------------------

CREATE TABLE IF NOT EXISTS run_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    span_id uuid REFERENCES run_events(span_id),
    artifact_type character varying(50) NOT NULL,  -- screenshot, log, video, diff, etc.
    storage_backend character varying(50) NOT NULL, -- local, s3, nas
    storage_key text NOT NULL,                     -- path or S3 key
    content_type character varying(100),           -- image/png, text/plain, video/mp4
    size_bytes bigint,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,           -- TTL for auto-cleanup
    metadata jsonb                                 -- Additional metadata (resolution, duration, etc.)
);

CREATE INDEX idx_run_artifacts_span_id ON run_artifacts(span_id);
CREATE INDEX idx_run_artifacts_type ON run_artifacts(artifact_type);
CREATE INDEX idx_run_artifacts_expires ON run_artifacts(expires_at) WHERE expires_at IS NOT NULL;

COMMENT ON TABLE run_artifacts IS 'Artifact metadata for run_events - use GET /api/brain/trace/artifacts/:id for access';
COMMENT ON COLUMN run_artifacts.storage_backend IS 'local (file path), s3 (S3 key), nas (NAS mount path)';
COMMENT ON COLUMN run_artifacts.storage_key IS 'Storage-specific identifier (file path for local, S3 key for s3, etc.)';
COMMENT ON COLUMN run_artifacts.expires_at IS 'Auto-delete after this timestamp (NULL = never expire)';

-----------------------------------
-- ROLLBACK SCRIPT (commented out)
-----------------------------------

/*
DROP VIEW IF EXISTS v_active_runs;
DROP VIEW IF EXISTS v_run_summary;
DROP VIEW IF EXISTS v_top_failure_reasons;
DROP VIEW IF EXISTS v_run_last_alive_span;
DROP FUNCTION IF EXISTS update_run_heartbeat(uuid);
DROP FUNCTION IF EXISTS detect_stuck_runs();
DROP FUNCTION IF EXISTS cleanup_expired_runs(integer);
DROP TABLE IF EXISTS run_artifacts;
DROP TABLE IF EXISTS run_events;
*/
