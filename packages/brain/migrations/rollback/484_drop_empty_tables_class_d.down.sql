-- 回滚 484：按 2026-09-29 生产 pg_dump -s 原样重建 7 张表（空表，无数据可回填）。引用代码需一并 revert 本 PR。
BEGIN;
\restrict fZVeOktugLOizMPzBno6OfOFKLQ5wWqjVeykkHa2s8exedS8iC5jwt8lChvLmrB

CREATE TABLE public.alex_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    content_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    area text,
    project text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    page_type text DEFAULT 'note'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.content_topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    hook text,
    body_draft text,
    target_platforms text[] DEFAULT '{}'::text[],
    ai_score numeric(3,1),
    score_reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    account_profile jsonb,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    adopted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_topics_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'adopted'::text, 'skipped'::text])))
);

CREATE TABLE public.dev_execution_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    run_id uuid NOT NULL,
    phase character varying(50) NOT NULL,
    status character varying(20) NOT NULL,
    error_message text,
    metadata jsonb,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.dev_reviews (
    id integer NOT NULL,
    pr_number integer,
    branch text,
    point_code text NOT NULL,
    decision text NOT NULL,
    confidence text NOT NULL,
    quality_score integer NOT NULL,
    risks jsonb DEFAULT '[]'::jsonb,
    anchors_user_words text,
    anchors_code text,
    anchors_okr text,
    next_step text,
    raw_markdown text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT dev_reviews_quality_score_check CHECK (((quality_score >= 0) AND (quality_score <= 10)))
);

COMMENT ON TABLE public.dev_reviews IS 'Phase 8.3: Structured Review Block 存储 — /dev 自审点（B-4/B-5/B-6/SDD-2/SDD-3）的打分与决策';

COMMENT ON COLUMN public.dev_reviews.point_code IS 'Superpowers 交互点代号';

COMMENT ON COLUMN public.dev_reviews.decision IS 'APPROVE / REQUEST_CHANGES / PASS_WITH_CONCERNS';

COMMENT ON COLUMN public.dev_reviews.confidence IS 'HIGH / MEDIUM / LOW';

COMMENT ON COLUMN public.dev_reviews.quality_score IS '0-10';

COMMENT ON COLUMN public.dev_reviews.risks IS 'JSONB array of {risk, impact}';

CREATE SEQUENCE public.dev_reviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.dev_reviews_id_seq OWNED BY public.dev_reviews.id;

CREATE TABLE public.llm_usage_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying(64) NOT NULL,
    five_hour_pct double precision DEFAULT 0 NOT NULL,
    seven_day_pct double precision DEFAULT 0 NOT NULL,
    seven_day_sonnet_pct double precision DEFAULT 0 NOT NULL,
    is_spending_capped boolean DEFAULT false NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.project_repos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    repo_path text NOT NULL,
    role text DEFAULT 'primary'::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.tick_history (
    id integer NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    duration_ms integer,
    actions_executed integer DEFAULT 0,
    success boolean DEFAULT true,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    execution_time_ms integer
);

CREATE SEQUENCE public.tick_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.tick_history_id_seq OWNED BY public.tick_history.id;

ALTER TABLE ONLY public.dev_reviews ALTER COLUMN id SET DEFAULT nextval('public.dev_reviews_id_seq'::regclass);

ALTER TABLE ONLY public.tick_history ALTER COLUMN id SET DEFAULT nextval('public.tick_history_id_seq'::regclass);

ALTER TABLE ONLY public.alex_pages
    ADD CONSTRAINT alex_pages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.content_topics
    ADD CONSTRAINT content_topics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dev_execution_logs
    ADD CONSTRAINT dev_execution_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dev_reviews
    ADD CONSTRAINT dev_reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.llm_usage_snapshots
    ADD CONSTRAINT llm_usage_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_repos
    ADD CONSTRAINT project_repos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_repos
    ADD CONSTRAINT project_repos_project_id_repo_path_key UNIQUE (project_id, repo_path);

ALTER TABLE ONLY public.tick_history
    ADD CONSTRAINT tick_history_pkey PRIMARY KEY (id);

CREATE INDEX idx_alex_pages_area ON public.alex_pages USING btree (area);

CREATE INDEX idx_alex_pages_created_at ON public.alex_pages USING btree (created_at DESC);

CREATE INDEX idx_alex_pages_page_type ON public.alex_pages USING btree (page_type);

CREATE INDEX idx_content_topics_created_at ON public.content_topics USING btree (created_at DESC);

CREATE INDEX idx_content_topics_status ON public.content_topics USING btree (status);

CREATE INDEX idx_dev_logs_phase_status ON public.dev_execution_logs USING btree (phase, status);

CREATE INDEX idx_dev_logs_run ON public.dev_execution_logs USING btree (run_id);

CREATE INDEX idx_dev_logs_task ON public.dev_execution_logs USING btree (task_id);

CREATE INDEX idx_dev_reviews_created ON public.dev_reviews USING btree (created_at DESC);

CREATE INDEX idx_dev_reviews_point ON public.dev_reviews USING btree (point_code);

CREATE INDEX idx_dev_reviews_pr ON public.dev_reviews USING btree (pr_number);

CREATE INDEX idx_llm_usage_snapshots_account_time ON public.llm_usage_snapshots USING btree (account_id, recorded_at DESC);

CREATE INDEX idx_llm_usage_snapshots_recorded_at ON public.llm_usage_snapshots USING btree (recorded_at DESC);

ALTER TABLE ONLY public.dev_execution_logs
    ADD CONSTRAINT dev_execution_logs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);

\unrestrict fZVeOktugLOizMPzBno6OfOFKLQ5wWqjVeykkHa2s8exedS8iC5jwt8lChvLmrB

DELETE FROM schema_version WHERE version = '484';
COMMIT;
