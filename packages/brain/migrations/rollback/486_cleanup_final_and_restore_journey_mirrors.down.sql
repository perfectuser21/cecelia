-- 回滚 486：按 2026-09-29 生产 pg_dump -s 原样重建 6 张表（空表）；两镜子登记回到 archived/none（迁移 480 状态）。
-- 引用代码需一并 revert 本 PR。
BEGIN;
\restrict 0cdrRdsJUzZ0J6cN2ykZMHI7LT9b0GdSOq1PiXmGdW5JeiaWuVt6BZDcgrbsiNl

CREATE TABLE public.keyword_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    license_id uuid NOT NULL,
    keyword text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT keyword_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text])))
);

CREATE TABLE public.license_credit_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    license_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    balance_after numeric(12,2) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.license_machines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    license_id uuid NOT NULL,
    machine_id text NOT NULL,
    machine_name text,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.licenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    license_key text NOT NULL,
    tier text NOT NULL,
    max_machines integer NOT NULL,
    customer_name text,
    customer_email text,
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    credit_balance numeric(12,2) DEFAULT 0 NOT NULL,
    CONSTRAINT licenses_credit_balance_check CHECK ((credit_balance >= (0)::numeric)),
    CONSTRAINT licenses_max_machines_check CHECK ((max_machines > 0)),
    CONSTRAINT licenses_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text]))),
    CONSTRAINT licenses_tier_check CHECK ((tier = ANY (ARRAY['basic'::text, 'matrix'::text, 'studio'::text, 'enterprise'::text])))
);

CREATE TABLE public.publish_success_daily (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform character varying(64) NOT NULL,
    date date NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    completed integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    success_rate numeric(5,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.topic_decision_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    week_key character varying(10) NOT NULL,
    topic_keyword text NOT NULL,
    heat_score numeric(6,2) DEFAULT 0,
    total_views bigint DEFAULT 0,
    total_likes bigint DEFAULT 0,
    total_comments bigint DEFAULT 0,
    total_shares bigint DEFAULT 0,
    publish_count integer DEFAULT 0,
    recommended_next_week boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.keyword_tasks
    ADD CONSTRAINT keyword_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.license_credit_transactions
    ADD CONSTRAINT license_credit_transactions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.license_machines
    ADD CONSTRAINT license_machines_license_id_machine_id_key UNIQUE (license_id, machine_id);

ALTER TABLE ONLY public.license_machines
    ADD CONSTRAINT license_machines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.licenses
    ADD CONSTRAINT licenses_license_key_key UNIQUE (license_key);

ALTER TABLE ONLY public.licenses
    ADD CONSTRAINT licenses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.publish_success_daily
    ADD CONSTRAINT publish_success_daily_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.topic_decision_feedback
    ADD CONSTRAINT topic_decision_feedback_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.publish_success_daily
    ADD CONSTRAINT uq_publish_success_daily_platform_date UNIQUE (platform, date);

CREATE INDEX idx_credit_tx_license_id ON public.license_credit_transactions USING btree (license_id);

CREATE INDEX idx_keyword_tasks_license_status ON public.keyword_tasks USING btree (license_id, status);

CREATE INDEX idx_license_machines_license_id ON public.license_machines USING btree (license_id);

CREATE INDEX idx_licenses_key ON public.licenses USING btree (license_key);

CREATE INDEX idx_licenses_status ON public.licenses USING btree (status) WHERE (status = 'active'::text);

CREATE INDEX idx_publish_success_daily_date ON public.publish_success_daily USING btree (date DESC);

CREATE INDEX idx_publish_success_daily_platform ON public.publish_success_daily USING btree (platform, date DESC);

CREATE INDEX idx_topic_decision_feedback_heat ON public.topic_decision_feedback USING btree (heat_score DESC, week_key DESC);

CREATE INDEX idx_topic_decision_feedback_week ON public.topic_decision_feedback USING btree (week_key DESC);

CREATE UNIQUE INDEX idx_topic_decision_feedback_week_keyword ON public.topic_decision_feedback USING btree (week_key, topic_keyword);

ALTER TABLE ONLY public.keyword_tasks
    ADD CONSTRAINT keyword_tasks_license_id_fkey FOREIGN KEY (license_id) REFERENCES public.licenses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.license_credit_transactions
    ADD CONSTRAINT license_credit_transactions_license_id_fkey FOREIGN KEY (license_id) REFERENCES public.licenses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.license_machines
    ADD CONSTRAINT license_machines_license_id_fkey FOREIGN KEY (license_id) REFERENCES public.licenses(id) ON DELETE CASCADE;

\unrestrict 0cdrRdsJUzZ0J6cN2ykZMHI7LT9b0GdSOq1PiXmGdW5JeiaWuVt6BZDcgrbsiNl

UPDATE notion_projection_map SET status = 'archived', direction = 'none', updated_at = NOW()
 WHERE notion_db_id IN ('358c40c2-ba63-8148-bde7-e313d789931a', '358c40c2-ba63-81e3-96c5-d762b3d34dff')
   AND brain_table IN ('journeys', 'journey_features');
DELETE FROM schema_version WHERE version = '486';
COMMIT;
