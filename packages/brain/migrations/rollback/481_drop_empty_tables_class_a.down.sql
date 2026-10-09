-- 回滚 481：按 2026-09-28 生产 pg_dump -s 原样重建 37 张表 + 5 个视图（空表，无数据可回填）。
-- 原始完整备份：~/db-backups/brain-empty-tables-20260928/brain-76-empty-tables.sql
BEGIN;
\restrict XyPU9raSmfK6VO3DV0kfmbegnTcUUvhcITin9zQFQdqbA64UQRaHV5ZaZNXlTbv

CREATE TABLE public.acceptance_run (
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text NOT NULL,
    app_id text NOT NULL,
    line_id text NOT NULL,
    surface text NOT NULL,
    task_id text NOT NULL,
    sha text NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    submitted_at timestamp with time zone,
    CONSTRAINT acceptance_run_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'submitted'::text, 'cancelled'::text])))
);

CREATE TABLE public.acceptance_template (
    id text NOT NULL,
    tenant_id text NOT NULL,
    kind text NOT NULL,
    seq integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    description text,
    app_id text,
    line_id text,
    surface text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    CONSTRAINT acceptance_template_kind_check CHECK ((kind = ANY (ARRAY['FR'::text, 'NFR'::text, 'Invariant'::text, 'SOP'::text])))
);

CREATE TABLE public.account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    scope text,
    password text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE VIEW public.active_sessions AS
SELECT
    NULL::uuid AS id,
    NULL::character varying(255) AS session_id,
    NULL::character varying(255) AS user_id,
    NULL::text AS user_agent,
    NULL::inet AS ip_address,
    NULL::text AS referrer,
    NULL::character varying(100) AS utm_source,
    NULL::character varying(100) AS utm_medium,
    NULL::character varying(100) AS utm_campaign,
    NULL::timestamp with time zone AS started_at,
    NULL::timestamp with time zone AS ended_at,
    NULL::integer AS duration_ms,
    NULL::integer AS page_views,
    NULL::integer AS events_count,
    NULL::jsonb AS metadata,
    NULL::timestamp with time zone AS created_at,
    NULL::timestamp with time zone AS updated_at,
    NULL::bigint AS total_events,
    NULL::bigint AS total_page_views,
    NULL::timestamp with time zone AS last_activity;

CREATE TABLE public.analytics_aggregations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    metric_name character varying(100) NOT NULL,
    metric_type character varying(50) NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    dimensions jsonb DEFAULT '{}'::jsonb,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.analytics_aggregations IS 'Pre-computed metrics for dashboard and reporting performance';

CREATE TABLE public.bottleneck_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    bottleneck_type character varying(100) NOT NULL,
    severity character varying(20) NOT NULL,
    metric_value numeric,
    threshold numeric,
    suggested_action character varying(200),
    description text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bottleneck_items_severity_check CHECK (((severity)::text = ANY (ARRAY[('critical'::character varying)::text, ('warning'::character varying)::text, ('info'::character varying)::text])))
);

COMMENT ON TABLE public.bottleneck_items IS '瓶颈明细表';

COMMENT ON COLUMN public.bottleneck_items.bottleneck_type IS '瓶颈类型：low_dispatch_success, long_queue_wait, recurring_failure_pattern, high_memory_usage';

COMMENT ON COLUMN public.bottleneck_items.severity IS '严重程度：critical, warning, info';

COMMENT ON COLUMN public.bottleneck_items.metric_value IS '当前指标值';

COMMENT ON COLUMN public.bottleneck_items.threshold IS '阈值';

COMMENT ON COLUMN public.bottleneck_items.suggested_action IS '建议采取的行动';

COMMENT ON COLUMN public.bottleneck_items.description IS '瓶颈描述';

CREATE TABLE public.bottleneck_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_data jsonb NOT NULL,
    critical_count integer DEFAULT 0 NOT NULL,
    warning_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.bottleneck_reports IS '瓶颈检测报告表';

COMMENT ON COLUMN public.bottleneck_reports.report_data IS '完整报告 JSON，包含 bottlenecks 和 recommendations';

COMMENT ON COLUMN public.bottleneck_reports.critical_count IS '严重瓶颈数量';

COMMENT ON COLUMN public.bottleneck_reports.warning_count IS '警告级别瓶颈数量';

CREATE TABLE public.bottleneck_scans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scan_time timestamp without time zone DEFAULT now() NOT NULL,
    bottleneck_type text,
    severity text NOT NULL,
    affected_component text,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    description text,
    root_cause text,
    status text DEFAULT 'identified'::text NOT NULL,
    mitigation_task_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    scan_type character varying(50),
    bottleneck_area character varying(100),
    details jsonb DEFAULT '{}'::jsonb,
    recommendations jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT bottleneck_scans_bottleneck_type_check CHECK ((bottleneck_type = ANY (ARRAY['performance'::text, 'resource'::text, 'logic'::text, 'workflow'::text]))),
    CONSTRAINT bottleneck_scans_severity_check CHECK ((severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT bottleneck_scans_status_check CHECK ((status = ANY (ARRAY['identified'::text, 'analyzed'::text, 'mitigated'::text, 'resolved'::text])))
);

COMMENT ON TABLE public.bottleneck_scans IS 'System bottleneck scan results for proactive monitoring';

COMMENT ON COLUMN public.bottleneck_scans.bottleneck_type IS 'Type of bottleneck: performance, resource, logic, workflow';

COMMENT ON COLUMN public.bottleneck_scans.severity IS 'Severity level: critical, high, medium, low';

COMMENT ON COLUMN public.bottleneck_scans.affected_component IS 'Component affected by the bottleneck (e.g., task_executor, tick_loop)';

COMMENT ON COLUMN public.bottleneck_scans.metrics IS 'Related metrics data (e.g., queue length, failure rate, resource usage)';

COMMENT ON COLUMN public.bottleneck_scans.status IS 'Current status: identified, analyzed, mitigated, resolved';

COMMENT ON COLUMN public.bottleneck_scans.mitigation_task_id IS 'ID of the task created to address this bottleneck';

CREATE TABLE public.brain_health_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(20) NOT NULL,
    response_ms integer,
    heal_triggered boolean DEFAULT false NOT NULL,
    heal_result character varying(20),
    error_detail text
);

CREATE TABLE public.check_result (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_result_id uuid NOT NULL,
    run_id uuid NOT NULL,
    tenant_id text NOT NULL,
    template_id text NOT NULL,
    result text DEFAULT 'pending'::text NOT NULL,
    evidence text,
    checked_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT check_result_result_check CHECK ((result = ANY (ARRAY['PASS'::text, 'FAIL'::text, 'BLOCKED'::text, 'pending'::text])))
);

CREATE TABLE public.code_scan_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scan_type character varying(50) NOT NULL,
    file_path text NOT NULL,
    issue_description text NOT NULL,
    suggested_task_title text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.conversations_legacy_pre_359 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mode character varying(50),
    topic character varying(200),
    summary text,
    key_points text[],
    action_items text[],
    area character varying(50),
    session_date timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    area_id uuid
);

CREATE TABLE public.decision_experiences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    decision_id uuid,
    task_id uuid,
    run_id uuid,
    trigger text NOT NULL,
    context jsonb NOT NULL,
    actions_taken jsonb NOT NULL,
    level integer NOT NULL,
    confidence numeric NOT NULL,
    outcome character varying(50),
    execution_time_ms integer,
    resource_usage jsonb,
    error_details jsonb,
    matched_pattern_id uuid,
    pattern_match_score numeric,
    deviation_from_pattern jsonb,
    was_effective boolean,
    human_feedback jsonb,
    learning_notes text,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.device_result (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    tenant_id text NOT NULL,
    device_index integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_result_device_index_check CHECK (((device_index >= 1) AND (device_index <= 5)))
);

CREATE TABLE public.event_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id character varying(255) NOT NULL,
    events_count integer DEFAULT 0 NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processing_started_at timestamp with time zone,
    processing_completed_at timestamp with time zone,
    processing_status public.event_status DEFAULT 'pending'::public.event_status,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.event_batches IS 'Batch processing queue for high-volume event ingestion';

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id character varying(255),
    event_type public.event_type NOT NULL,
    event_name character varying(255) NOT NULL,
    event_category character varying(100),
    event_action character varying(100),
    event_label character varying(255),
    event_value numeric,
    page_url text,
    page_title character varying(500),
    page_path character varying(500),
    user_id character varying(255),
    anonymous_id character varying(255),
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    client_timestamp timestamp with time zone,
    processing_status public.event_status DEFAULT 'pending'::public.event_status,
    processing_attempts integer DEFAULT 0,
    processed_at timestamp with time zone,
    properties jsonb DEFAULT '{}'::jsonb,
    context jsonb DEFAULT '{}'::jsonb,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.events IS 'Core analytics events table storing all user interactions and system events';

COMMENT ON COLUMN public.events.properties IS 'Custom event properties as JSONB for flexible schema';

COMMENT ON COLUMN public.events.context IS 'Event context including device, browser, location data';

CREATE VIEW public.event_summary AS
 SELECT date_trunc('hour'::text, "timestamp") AS hour,
    event_type,
    count(*) AS event_count,
    count(DISTINCT session_id) AS unique_sessions,
    count(DISTINCT user_id) AS unique_users,
    avg(duration_ms) AS avg_duration_ms
   FROM public.events
  WHERE ("timestamp" > (now() - '24:00:00'::interval))
  GROUP BY (date_trunc('hour'::text, "timestamp")), event_type;

CREATE TABLE public.evolution_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learning_id uuid,
    evolution_type character varying(50) NOT NULL,
    description text,
    snapshot_before jsonb,
    snapshot_after jsonb,
    metrics_before jsonb,
    metrics_after jsonb,
    evaluation_window_days integer DEFAULT 7,
    evaluation_start_date timestamp with time zone DEFAULT now(),
    evaluation_end_date timestamp with time zone,
    effectiveness_score double precision,
    effectiveness_evaluated_at timestamp with time zone,
    rollback_applied boolean DEFAULT false,
    rollback_at timestamp with time zone,
    rollback_reason text,
    created_by character varying(100),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.evolution_history IS 'Track evolution iterations with before/after snapshots and effectiveness metrics';

COMMENT ON COLUMN public.evolution_history.learning_id IS 'Reference to the learning that triggered this evolution (nullable for manual evolutions)';

COMMENT ON COLUMN public.evolution_history.evolution_type IS 'Type of evolution: refactor, optimization, feature, fix';

COMMENT ON COLUMN public.evolution_history.snapshot_before IS 'Sanitized snapshot of state before change (no secrets)';

COMMENT ON COLUMN public.evolution_history.snapshot_after IS 'Sanitized snapshot of state after change (no secrets)';

COMMENT ON COLUMN public.evolution_history.metrics_before IS 'Performance metrics before change (execution_time_ms, memory_mb, success_rate, etc.)';

COMMENT ON COLUMN public.evolution_history.metrics_after IS 'Performance metrics after change (execution_time_ms, memory_mb, success_rate, etc.)';

COMMENT ON COLUMN public.evolution_history.evaluation_window_days IS 'Days to observe impact before calculating effectiveness (default 7 days)';

COMMENT ON COLUMN public.evolution_history.effectiveness_score IS 'Calculated effectiveness score (0-100) after evaluation window';

COMMENT ON COLUMN public.evolution_history.rollback_applied IS 'Whether this evolution was rolled back';

CREATE TABLE public.failure_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid,
    failure_reason text NOT NULL,
    failure_type character varying(100) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.incidents_legacy_pre346 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(200) NOT NULL,
    severity character varying(20),
    description text,
    root_cause text,
    resolution text,
    prevention text,
    occurred_at timestamp without time zone,
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.learning_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    experience_id uuid,
    priority integer DEFAULT 5,
    status character varying(20) DEFAULT 'pending'::character varying,
    processed_at timestamp without time zone,
    extraction_result jsonb,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.page_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id character varying(255),
    event_id uuid,
    page_url text NOT NULL,
    page_title character varying(500),
    page_path character varying(500) NOT NULL,
    query_params jsonb DEFAULT '{}'::jsonb,
    entered_at timestamp with time zone DEFAULT now() NOT NULL,
    left_at timestamp with time zone,
    time_on_page_ms integer,
    scroll_depth numeric,
    clicks_count integer DEFAULT 0,
    dom_ready_ms integer,
    page_load_ms integer,
    exit_link text,
    is_bounce boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT page_views_scroll_depth_check CHECK (((scroll_depth >= (0)::numeric) AND (scroll_depth <= (100)::numeric)))
);

COMMENT ON TABLE public.page_views IS 'Detailed page view analytics including performance and interaction metrics';

COMMENT ON COLUMN public.page_views.scroll_depth IS 'Maximum scroll depth reached as percentage (0-100)';

CREATE TABLE public.pattern_similarity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pattern_a_id uuid,
    pattern_b_id uuid,
    similarity_score numeric NOT NULL,
    CONSTRAINT pattern_similarity_check CHECK ((pattern_a_id < pattern_b_id))
);

CREATE TABLE public.policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer DEFAULT 1,
    content_json jsonb,
    active boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.publish_daily_stats (
    id bigint NOT NULL,
    stat_date date NOT NULL,
    platform text NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    fail_count integer DEFAULT 0 NOT NULL,
    total_count integer DEFAULT 0 NOT NULL,
    success_rate numeric(5,4) DEFAULT 0 NOT NULL,
    alert_sent boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.publish_daily_stats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.publish_daily_stats_id_seq OWNED BY public.publish_daily_stats.id;

CREATE TABLE public.review_environments (
    initiative_id text NOT NULL,
    port integer NOT NULL,
    pid integer NOT NULL,
    allocated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_environments_port_check CHECK (((port >= 5300) AND (port <= 5399)))
);

CREATE TABLE public.rule_violation_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_id uuid,
    task_id uuid,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    violation_data jsonb,
    created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.rule_violation_logs IS 'History of rule violations for analysis';

COMMENT ON COLUMN public.rule_violation_logs.violation_data IS 'Details about the violation';

CREATE TABLE public.session (
    id text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL
);

CREATE TABLE public.snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_json jsonb,
    ts timestamp without time zone DEFAULT now()
);

CREATE TABLE public.strategies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    conditions jsonb DEFAULT '[]'::jsonb,
    actions jsonb DEFAULT '[]'::jsonb,
    version character varying(20) DEFAULT '1.0.0'::character varying,
    created_from_learning_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    metadata jsonb
);

CREATE TABLE public.task_quality_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid,
    checked_at timestamp without time zone DEFAULT now(),
    violations jsonb DEFAULT '[]'::jsonb,
    status character varying(10),
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT task_quality_checks_status_check CHECK (((status)::text = ANY (ARRAY[('pass'::character varying)::text, ('fail'::character varying)::text])))
);

COMMENT ON TABLE public.task_quality_checks IS 'Stores quality check results for task descriptions';

COMMENT ON COLUMN public.task_quality_checks.violations IS 'Array of rule violations in JSONB format: [{rule: string, message: string}]';

CREATE TABLE public.trd_decomposition_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trd_id uuid,
    task_id uuid,
    milestone text,
    prd_title text,
    sequence_order integer,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.trds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    content text,
    project_id uuid,
    goal_id uuid,
    status character varying(50) DEFAULT 'draft'::character varying,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    image text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.user_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id character varying(255) NOT NULL,
    user_id character varying(255),
    user_agent text,
    ip_address inet,
    referrer text,
    utm_source character varying(100),
    utm_medium character varying(100),
    utm_campaign character varying(100),
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    duration_ms integer,
    page_views integer DEFAULT 0,
    events_count integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.user_sessions IS 'User session tracking for analytics and user journey analysis';

COMMENT ON COLUMN public.user_sessions.metadata IS 'Additional session metadata like device info, location';

CREATE VIEW public.v_evolution_effectiveness_summary AS
 SELECT evolution_type,
    count(*) AS total_evolutions,
    count(*) FILTER (WHERE (effectiveness_score IS NOT NULL)) AS evaluated_count,
    count(*) FILTER (WHERE (rollback_applied = true)) AS rollback_count,
    avg(effectiveness_score) AS avg_effectiveness_score,
    min(effectiveness_score) AS min_effectiveness_score,
    max(effectiveness_score) AS max_effectiveness_score,
    percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY effectiveness_score) AS median_effectiveness_score
   FROM public.evolution_history
  GROUP BY evolution_type
  ORDER BY (avg(effectiveness_score)) DESC;

CREATE VIEW public.v_pending_evolution_evaluations AS
 SELECT id,
    learning_id,
    evolution_type,
    description,
    evaluation_window_days,
    evaluation_start_date,
    (EXTRACT(epoch FROM (now() - evaluation_start_date)) / (86400)::numeric) AS days_elapsed,
    metrics_before,
    metrics_after,
    created_at
   FROM public.evolution_history
  WHERE ((effectiveness_score IS NULL) AND (rollback_applied = false) AND (now() >= (evaluation_start_date + ((evaluation_window_days || ' days'::text))::interval)))
  ORDER BY evaluation_start_date;

CREATE VIEW public.v_recent_rollbacks AS
 SELECT id,
    learning_id,
    evolution_type,
    description,
    effectiveness_score,
    rollback_at,
    rollback_reason,
    created_at
   FROM public.evolution_history
  WHERE ((rollback_applied = true) AND (rollback_at > (now() - '30 days'::interval)))
  ORDER BY rollback_at DESC;

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.voice_call_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text NOT NULL,
    contact_name text NOT NULL,
    wechat_account text,
    status text NOT NULL,
    duration_seconds integer DEFAULT 0 NOT NULL,
    called_at timestamp with time zone DEFAULT now() NOT NULL,
    call_id text,
    bubble_text text,
    error_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rtc_token_issued_at timestamp with time zone,
    sidecar_joined_at timestamp with time zone,
    ai_agent_joined_at timestamp with time zone,
    first_audio_at timestamp with time zone,
    tts_first_byte_at timestamp with time zone,
    cleanup_done_at timestamp with time zone,
    CONSTRAINT voice_call_records_status_check CHECK ((status = ANY (ARRAY['answered'::text, 'no_answer'::text, 'failed'::text])))
);

CREATE TABLE public.watchdog_bottleneck_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id character varying(100),
    pid integer,
    pgid integer,
    slot character varying(50),
    action character varying(20) NOT NULL,
    reason text NOT NULL,
    rss_mb integer,
    cpu_pct integer,
    pressure numeric(5,2),
    evidence jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT watchdog_bottleneck_records_action_check CHECK (((action)::text = ANY (ARRAY[('warn'::character varying)::text, ('kill'::character varying)::text, ('kill_if_top_offender'::character varying)::text])))
);

CREATE TABLE public.wechat_rpa_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid,
    action_type text NOT NULL,
    outcome text DEFAULT 'pending'::text NOT NULL,
    dryrun boolean DEFAULT false NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb,
    error_msg text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_wechat_action_type CHECK ((action_type = ANY (ARRAY['send_message'::text, 'screenshot'::text, 'click'::text, 'read_inbox'::text, 'health_check'::text]))),
    CONSTRAINT chk_wechat_outcome CHECK ((outcome = ANY (ARRAY['pending'::text, 'success'::text, 'failed'::text, 'timeout'::text, 'skipped_dryrun'::text])))
);

ALTER TABLE ONLY public.publish_daily_stats ALTER COLUMN id SET DEFAULT nextval('public.publish_daily_stats_id_seq'::regclass);

ALTER TABLE ONLY public.acceptance_run
    ADD CONSTRAINT acceptance_run_pkey PRIMARY KEY (run_id);

ALTER TABLE ONLY public.acceptance_run
    ADD CONSTRAINT acceptance_run_tenant_id_task_id_sha_key UNIQUE (tenant_id, task_id, sha);

ALTER TABLE ONLY public.acceptance_template
    ADD CONSTRAINT acceptance_template_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.analytics_aggregations
    ADD CONSTRAINT analytics_aggregations_metric_name_metric_type_period_start_key UNIQUE (metric_name, metric_type, period_start, dimensions);

ALTER TABLE ONLY public.analytics_aggregations
    ADD CONSTRAINT analytics_aggregations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bottleneck_items
    ADD CONSTRAINT bottleneck_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bottleneck_reports
    ADD CONSTRAINT bottleneck_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bottleneck_scans
    ADD CONSTRAINT bottleneck_scans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.brain_health_checks
    ADD CONSTRAINT brain_health_checks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.check_result
    ADD CONSTRAINT check_result_device_result_id_template_id_key UNIQUE (device_result_id, template_id);

ALTER TABLE ONLY public.check_result
    ADD CONSTRAINT check_result_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.code_scan_results
    ADD CONSTRAINT code_scan_results_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversations_legacy_pre_359
    ADD CONSTRAINT conversations_legacy_pre_359_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.decision_experiences
    ADD CONSTRAINT decision_experiences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.device_result
    ADD CONSTRAINT device_result_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.device_result
    ADD CONSTRAINT device_result_run_id_device_index_key UNIQUE (run_id, device_index);

ALTER TABLE ONLY public.event_batches
    ADD CONSTRAINT event_batches_batch_id_key UNIQUE (batch_id);

ALTER TABLE ONLY public.event_batches
    ADD CONSTRAINT event_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.evolution_history
    ADD CONSTRAINT evolution_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.failure_events
    ADD CONSTRAINT failure_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.incidents_legacy_pre346
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_queue
    ADD CONSTRAINT learning_queue_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_views
    ADD CONSTRAINT page_views_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pattern_similarity
    ADD CONSTRAINT pattern_similarity_pattern_a_id_pattern_b_id_key UNIQUE (pattern_a_id, pattern_b_id);

ALTER TABLE ONLY public.pattern_similarity
    ADD CONSTRAINT pattern_similarity_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.policies
    ADD CONSTRAINT policies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.publish_daily_stats
    ADD CONSTRAINT publish_daily_stats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.publish_daily_stats
    ADD CONSTRAINT publish_daily_stats_stat_date_platform_key UNIQUE (stat_date, platform);

ALTER TABLE ONLY public.review_environments
    ADD CONSTRAINT review_environments_pkey PRIMARY KEY (initiative_id);

ALTER TABLE ONLY public.rule_violation_logs
    ADD CONSTRAINT rule_violation_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_key UNIQUE (token);

ALTER TABLE ONLY public.snapshots
    ADD CONSTRAINT snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategies
    ADD CONSTRAINT strategies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_quality_checks
    ADD CONSTRAINT task_quality_checks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.trd_decomposition_tasks
    ADD CONSTRAINT trd_decomposition_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.trds
    ADD CONSTRAINT trds_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_session_id_key UNIQUE (session_id);

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.voice_call_records
    ADD CONSTRAINT voice_call_records_call_id_key UNIQUE (call_id);

ALTER TABLE ONLY public.voice_call_records
    ADD CONSTRAINT voice_call_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.watchdog_bottleneck_records
    ADD CONSTRAINT watchdog_bottleneck_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.wechat_rpa_sessions
    ADD CONSTRAINT wechat_rpa_sessions_pkey PRIMARY KEY (id);

CREATE INDEX acceptance_run_tenant_idx ON public.acceptance_run USING btree (tenant_id);

CREATE INDEX acceptance_template_tenant_idx ON public.acceptance_template USING btree (tenant_id);

CREATE INDEX "account_userId_idx" ON public.account USING btree ("userId");

CREATE INDEX idx_analytics_aggregations_lookup ON public.analytics_aggregations USING btree (metric_name, metric_type, period_start);

CREATE INDEX idx_bottleneck_items_report_id ON public.bottleneck_items USING btree (report_id);

CREATE INDEX idx_bottleneck_items_severity ON public.bottleneck_items USING btree (severity);

CREATE INDEX idx_bottleneck_items_type ON public.bottleneck_items USING btree (bottleneck_type);

CREATE INDEX idx_bottleneck_reports_created_at ON public.bottleneck_reports USING btree (created_at DESC);

CREATE INDEX idx_bottleneck_reports_critical_count ON public.bottleneck_reports USING btree (critical_count) WHERE (critical_count > 0);

CREATE INDEX idx_bottleneck_scans_affected_component ON public.bottleneck_scans USING btree (affected_component);

CREATE INDEX idx_bottleneck_scans_bottleneck_type ON public.bottleneck_scans USING btree (bottleneck_type);

CREATE INDEX idx_bottleneck_scans_scan_time ON public.bottleneck_scans USING btree (scan_time DESC);

CREATE INDEX idx_bottleneck_scans_scan_type ON public.bottleneck_scans USING btree (scan_type);

CREATE INDEX idx_bottleneck_scans_severity ON public.bottleneck_scans USING btree (severity);

CREATE INDEX idx_bottleneck_scans_status ON public.bottleneck_scans USING btree (status);

CREATE INDEX idx_brain_health_checks_checked_at ON public.brain_health_checks USING btree (checked_at DESC);

CREATE INDEX idx_code_scan_results_created_at ON public.code_scan_results USING btree (created_at DESC);

CREATE INDEX idx_code_scan_results_scan_type ON public.code_scan_results USING btree (scan_type);

CREATE INDEX idx_event_batches_received_at ON public.event_batches USING btree (received_at DESC);

CREATE INDEX idx_event_batches_status ON public.event_batches USING btree (processing_status);

CREATE INDEX idx_events_event_type ON public.events USING btree (event_type);

CREATE INDEX idx_events_processing_status ON public.events USING btree (processing_status) WHERE (processing_status = 'pending'::public.event_status);

CREATE INDEX idx_events_properties ON public.events USING gin (properties);

CREATE INDEX idx_events_session_id ON public.events USING btree (session_id);

CREATE INDEX idx_events_timestamp ON public.events USING btree ("timestamp" DESC);

CREATE INDEX idx_events_user_id ON public.events USING btree (user_id) WHERE (user_id IS NOT NULL);

CREATE INDEX idx_evolution_history_created_at ON public.evolution_history USING btree (created_at DESC);

CREATE INDEX idx_evolution_history_effectiveness_score ON public.evolution_history USING btree (effectiveness_score) WHERE (effectiveness_score IS NOT NULL);

CREATE INDEX idx_evolution_history_evaluation_end ON public.evolution_history USING btree (evaluation_end_date) WHERE (evaluation_end_date IS NOT NULL);

CREATE INDEX idx_evolution_history_learning_id ON public.evolution_history USING btree (learning_id) WHERE (learning_id IS NOT NULL);

CREATE INDEX idx_evolution_history_metrics_after ON public.evolution_history USING gin (metrics_after);

CREATE INDEX idx_evolution_history_metrics_before ON public.evolution_history USING gin (metrics_before);

CREATE INDEX idx_evolution_history_rollback ON public.evolution_history USING btree (rollback_applied) WHERE (rollback_applied = true);

CREATE INDEX idx_evolution_history_snapshot_after ON public.evolution_history USING gin (snapshot_after);

CREATE INDEX idx_evolution_history_snapshot_before ON public.evolution_history USING gin (snapshot_before);

CREATE INDEX idx_evolution_history_type ON public.evolution_history USING btree (evolution_type);

CREATE INDEX idx_experiences_created ON public.decision_experiences USING btree (created_at DESC);

CREATE INDEX idx_experiences_decision ON public.decision_experiences USING btree (decision_id);

CREATE INDEX idx_experiences_outcome ON public.decision_experiences USING btree (outcome);

CREATE INDEX idx_experiences_pattern ON public.decision_experiences USING btree (matched_pattern_id);

CREATE INDEX idx_failure_events_created_at ON public.failure_events USING btree (created_at);

CREATE INDEX idx_failure_events_failure_type ON public.failure_events USING btree (failure_type);

CREATE INDEX idx_failure_events_task_id ON public.failure_events USING btree (task_id);

CREATE INDEX idx_learning_queue_status ON public.learning_queue USING btree (status, priority);

CREATE INDEX idx_page_views_entered_at ON public.page_views USING btree (entered_at DESC);

CREATE INDEX idx_page_views_page_path ON public.page_views USING btree (page_path);

CREATE INDEX idx_page_views_session_id ON public.page_views USING btree (session_id);

CREATE INDEX idx_rule_violation_logs_rule_id ON public.rule_violation_logs USING btree (rule_id);

CREATE INDEX idx_rule_violation_logs_task_id ON public.rule_violation_logs USING btree (task_id);

CREATE INDEX idx_rule_violation_logs_timestamp ON public.rule_violation_logs USING btree ("timestamp" DESC);

CREATE INDEX idx_similarity_scores ON public.pattern_similarity USING btree (similarity_score DESC);

CREATE INDEX idx_strategies_created_at ON public.strategies USING btree (created_at);

CREATE INDEX idx_strategies_learning_id ON public.strategies USING btree (created_from_learning_id);

CREATE INDEX idx_strategies_name ON public.strategies USING btree (name);

CREATE INDEX idx_task_quality_checks_checked_at ON public.task_quality_checks USING btree (checked_at);

CREATE INDEX idx_task_quality_checks_status ON public.task_quality_checks USING btree (status);

CREATE INDEX idx_task_quality_checks_task_id ON public.task_quality_checks USING btree (task_id);

CREATE INDEX idx_trd_decomp_task ON public.trd_decomposition_tasks USING btree (task_id);

CREATE INDEX idx_trd_decomp_trd ON public.trd_decomposition_tasks USING btree (trd_id);

CREATE INDEX idx_user_sessions_started_at ON public.user_sessions USING btree (started_at DESC);

CREATE INDEX idx_user_sessions_user_id ON public.user_sessions USING btree (user_id) WHERE (user_id IS NOT NULL);

CREATE INDEX idx_voice_call_records_called_at ON public.voice_call_records USING btree (called_at DESC);

CREATE INDEX idx_voice_call_records_tenant_contact ON public.voice_call_records USING btree (tenant_id, contact_name);

CREATE INDEX idx_voice_call_records_tenant_id ON public.voice_call_records USING btree (tenant_id);

CREATE INDEX idx_watchdog_bottleneck_action ON public.watchdog_bottleneck_records USING btree (action);

CREATE INDEX idx_watchdog_bottleneck_created_at ON public.watchdog_bottleneck_records USING btree (created_at DESC);

CREATE INDEX idx_watchdog_bottleneck_task_id ON public.watchdog_bottleneck_records USING btree (task_id);

CREATE INDEX idx_wechat_rpa_sessions_action_type ON public.wechat_rpa_sessions USING btree (action_type);

CREATE INDEX idx_wechat_rpa_sessions_agent_time ON public.wechat_rpa_sessions USING btree (agent_id, created_at DESC);

CREATE INDEX idx_wechat_rpa_sessions_outcome ON public.wechat_rpa_sessions USING btree (outcome) WHERE (outcome = ANY (ARRAY['failed'::text, 'timeout'::text]));

CREATE INDEX publish_daily_stats_date_idx ON public.publish_daily_stats USING btree (stat_date DESC);

CREATE UNIQUE INDEX review_environments_port_idx ON public.review_environments USING btree (port);

CREATE INDEX "session_userId_idx" ON public.session USING btree ("userId");

CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);

CREATE OR REPLACE VIEW public.active_sessions AS
 SELECT s.id,
    s.session_id,
    s.user_id,
    s.user_agent,
    s.ip_address,
    s.referrer,
    s.utm_source,
    s.utm_medium,
    s.utm_campaign,
    s.started_at,
    s.ended_at,
    s.duration_ms,
    s.page_views,
    s.events_count,
    s.metadata,
    s.created_at,
    s.updated_at,
    count(DISTINCT e.id) AS total_events,
    count(DISTINCT pv.id) AS total_page_views,
    max(e."timestamp") AS last_activity
   FROM ((public.user_sessions s
     LEFT JOIN public.events e ON (((s.session_id)::text = (e.session_id)::text)))
     LEFT JOIN public.page_views pv ON (((s.session_id)::text = (pv.session_id)::text)))
  WHERE ((s.ended_at IS NULL) OR (s.ended_at > (now() - '00:30:00'::interval)))
  GROUP BY s.id;

CREATE TRIGGER trg_voice_call_records_updated_at BEFORE UPDATE ON public.voice_call_records FOR EACH ROW EXECUTE FUNCTION public.update_voice_call_records_updated_at();

CREATE TRIGGER update_analytics_aggregations_updated_at BEFORE UPDATE ON public.analytics_aggregations FOR EACH ROW EXECUTE FUNCTION public.update_user_session_updated_at();

CREATE TRIGGER update_user_sessions_updated_at BEFORE UPDATE ON public.user_sessions FOR EACH ROW EXECUTE FUNCTION public.update_user_session_updated_at();

ALTER TABLE ONLY public.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bottleneck_items
    ADD CONSTRAINT bottleneck_items_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.bottleneck_reports(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bottleneck_scans
    ADD CONSTRAINT bottleneck_scans_mitigation_task_id_fkey FOREIGN KEY (mitigation_task_id) REFERENCES public.tasks(id);

ALTER TABLE ONLY public.check_result
    ADD CONSTRAINT check_result_device_result_id_fkey FOREIGN KEY (device_result_id) REFERENCES public.device_result(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.decision_experiences
    ADD CONSTRAINT decision_experiences_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES public.decisions(id);

ALTER TABLE ONLY public.decision_experiences
    ADD CONSTRAINT decision_experiences_matched_pattern_id_fkey FOREIGN KEY (matched_pattern_id) REFERENCES public.decision_patterns(id);

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.user_sessions(session_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.evolution_history
    ADD CONSTRAINT evolution_history_learning_id_fkey FOREIGN KEY (learning_id) REFERENCES public.learnings(id);

ALTER TABLE ONLY public.failure_events
    ADD CONSTRAINT failure_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_queue
    ADD CONSTRAINT learning_queue_experience_id_fkey FOREIGN KEY (experience_id) REFERENCES public.decision_experiences(id);

ALTER TABLE ONLY public.page_views
    ADD CONSTRAINT page_views_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.page_views
    ADD CONSTRAINT page_views_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.user_sessions(session_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pattern_similarity
    ADD CONSTRAINT pattern_similarity_pattern_a_id_fkey FOREIGN KEY (pattern_a_id) REFERENCES public.decision_patterns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pattern_similarity
    ADD CONSTRAINT pattern_similarity_pattern_b_id_fkey FOREIGN KEY (pattern_b_id) REFERENCES public.decision_patterns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.rule_violation_logs
    ADD CONSTRAINT rule_violation_logs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.validation_rules(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.rule_violation_logs
    ADD CONSTRAINT rule_violation_logs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategies
    ADD CONSTRAINT strategies_created_from_learning_id_fkey FOREIGN KEY (created_from_learning_id) REFERENCES public.learnings(id);

ALTER TABLE ONLY public.task_quality_checks
    ADD CONSTRAINT task_quality_checks_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.trd_decomposition_tasks
    ADD CONSTRAINT trd_decomposition_tasks_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);

ALTER TABLE ONLY public.trd_decomposition_tasks
    ADD CONSTRAINT trd_decomposition_tasks_trd_id_fkey FOREIGN KEY (trd_id) REFERENCES public.trds(id);

\unrestrict XyPU9raSmfK6VO3DV0kfmbegnTcUUvhcITin9zQFQdqbA64UQRaHV5ZaZNXlTbv

DELETE FROM schema_version WHERE version = '481';
COMMIT;
