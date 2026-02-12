-- Migration 023: Add run_events table for full observability
-- Implements unified event stream for tracing execution across all layers

-- Core run_events table
CREATE TABLE IF NOT EXISTS run_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,

    -- Trace identifiers (OpenTelemetry-compatible)
    run_id uuid NOT NULL,                    -- End-to-end execution ID
    span_id uuid DEFAULT gen_random_uuid() NOT NULL, -- Step/span ID
    parent_span_id uuid,                     -- Parent step (for nested spans)

    -- Layer & Step identification
    layer character varying(50) NOT NULL,    -- L0_orchestrator, L1_brain, L2_executor, L3_browser, L4_artifact
    step_name character varying(255) NOT NULL, -- e.g., "connect_cdp", "upload_file", "fill_title"

    -- Status & Reason
    status character varying(50) NOT NULL,   -- queued, running, blocked, retrying, success, failed, canceled
    reason_code character varying(100),      -- MISSING_FILE, SELECTOR_NOT_FOUND, AUTH_EXPIRED, TIMEOUT, etc.

    -- Timestamps
    ts_start timestamp with time zone DEFAULT now(),
    ts_end timestamp with time zone,
    heartbeat_ts timestamp with time zone DEFAULT now(),

    -- Input/Output/Artifacts
    input_summary jsonb,                     -- Input parameters (sanitized, no secrets)
    output_summary jsonb,                    -- Output result (sanitized)
    artifacts jsonb,                         -- {"screenshot": "/path/to/file.png", "log": "/path/to/log.txt", "diff": "..."}

    -- Execution context
    machine_id character varying(100),       -- us-vps, hk-vps, mac-mini, node-pc
    region character varying(10),            -- us, hk
    retry_count integer DEFAULT 0,

    -- Metadata
    metadata jsonb,                          -- Flexible additional data

    -- Foreign keys
    task_id uuid REFERENCES tasks(id),       -- Link to tasks table

    created_at timestamp with time zone DEFAULT now()
);

-- Indexes for fast queries
CREATE INDEX idx_run_events_run_id ON run_events(run_id);
CREATE INDEX idx_run_events_span_id ON run_events(span_id);
CREATE INDEX idx_run_events_parent_span_id ON run_events(parent_span_id);
CREATE INDEX idx_run_events_layer ON run_events(layer);
CREATE INDEX idx_run_events_status ON run_events(status);
CREATE INDEX idx_run_events_reason_code ON run_events(reason_code) WHERE reason_code IS NOT NULL;
CREATE INDEX idx_run_events_task_id ON run_events(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_run_events_heartbeat ON run_events(heartbeat_ts) WHERE status = 'running';
CREATE INDEX idx_run_events_ts_start ON run_events(ts_start DESC);

-- GIN indexes for JSONB fields
CREATE INDEX idx_run_events_artifacts ON run_events USING gin(artifacts);
CREATE INDEX idx_run_events_metadata ON run_events USING gin(metadata);

-- Table comments
COMMENT ON TABLE run_events IS 'Unified event stream for observability - all layers write here';
COMMENT ON COLUMN run_events.run_id IS 'End-to-end execution ID (one task may have multiple runs if retried)';
COMMENT ON COLUMN run_events.span_id IS 'Individual step ID within a run';
COMMENT ON COLUMN run_events.layer IS 'Execution layer: L0_orchestrator, L1_brain, L2_executor, L3_browser, L4_artifact';
COMMENT ON COLUMN run_events.reason_code IS 'Enumerated failure reason for aggregation and analytics';
COMMENT ON COLUMN run_events.heartbeat_ts IS 'Last heartbeat timestamp - used to detect stuck/zombie runs';
COMMENT ON COLUMN run_events.artifacts IS 'Pointers to evidence: {"screenshot": "path", "log": "path", "video": "url"}';

-- View: Active runs (currently running, with last heartbeat)
CREATE OR REPLACE VIEW v_active_runs AS
SELECT
    run_id,
    task_id,
    layer,
    step_name,
    machine_id,
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
    layer,
    COUNT(*) AS failure_count,
    MAX(ts_start) AS last_occurrence
FROM run_events
WHERE status = 'failed'
    AND reason_code IS NOT NULL
    AND ts_start > now() - interval '24 hours'
GROUP BY reason_code, layer
ORDER BY failure_count DESC
LIMIT 20;

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
CREATE OR REPLACE FUNCTION detect_stuck_runs()
RETURNS TABLE(run_id uuid, span_id uuid, layer text, step_name text, stuck_duration_seconds numeric) AS $$
BEGIN
    RETURN QUERY
    SELECT
        re.run_id,
        re.span_id,
        re.layer::text,
        re.step_name::text,
        EXTRACT(EPOCH FROM (now() - re.heartbeat_ts)) AS stuck_duration_seconds
    FROM run_events re
    WHERE re.status = 'running'
        AND EXTRACT(EPOCH FROM (now() - re.heartbeat_ts)) > 300
    ORDER BY stuck_duration_seconds DESC;
END;
$$ LANGUAGE plpgsql;

-- Rollback (uncomment to rollback)
/*
DROP VIEW IF EXISTS v_active_runs;
DROP VIEW IF EXISTS v_run_summary;
DROP VIEW IF EXISTS v_top_failure_reasons;
DROP FUNCTION IF EXISTS update_run_heartbeat(uuid);
DROP FUNCTION IF EXISTS detect_stuck_runs();
DROP TABLE IF EXISTS run_events;
*/
