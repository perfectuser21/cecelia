-- Base Schema for Cecelia Brain
-- Creates all tables needed before incremental migrations (001+)
-- Uses IF NOT EXISTS so it's safe to run on existing databases

-- areas (dependency for projects, tasks)
CREATE TABLE IF NOT EXISTS areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name character varying(100) NOT NULL,
    group_name character varying(100),
    description text,
    icon character varying(50),
    sort_order integer,
    created_at timestamp without time zone DEFAULT now()
);

-- projects
CREATE TABLE IF NOT EXISTS projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid,
    parent_id uuid REFERENCES projects(id),
    name character varying(255) NOT NULL,
    repo_path character varying(500),
    description text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    metadata jsonb,
    status character varying(50) DEFAULT 'active',
    area_id uuid REFERENCES areas(id)
);

-- goals
CREATE TABLE IF NOT EXISTS goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    project_id uuid REFERENCES projects(id),
    parent_id uuid REFERENCES goals(id),
    title character varying(255) NOT NULL,
    description text,
    status character varying(50) DEFAULT 'pending',
    priority character varying(10) DEFAULT 'P1',
    progress integer DEFAULT 0,
    weight numeric(3,2) DEFAULT 1.0,
    target_date date,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    owner_agent character varying(100),
    type character varying(50) DEFAULT 'objective',
    is_pinned boolean DEFAULT false,
    metadata jsonb
);

-- features
CREATE TABLE IF NOT EXISTS features (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    title text NOT NULL,
    description text,
    prd text,
    goal_id uuid REFERENCES goals(id),
    project_id uuid REFERENCES projects(id),
    status text DEFAULT 'planning' NOT NULL,
    active_task_id uuid,
    current_pr_number integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone
);

-- tasks
CREATE TABLE IF NOT EXISTS tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    goal_id uuid REFERENCES goals(id),
    project_id uuid REFERENCES projects(id),
    title character varying(255) NOT NULL,
    description text,
    status character varying(50) DEFAULT 'queued',
    priority character varying(10) DEFAULT 'P1',
    assigned_to character varying(100),
    payload jsonb,
    due_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now(),
    estimated_hours integer,
    tags text[],
    metadata jsonb,
    queued_at timestamp without time zone DEFAULT now(),
    area_id uuid REFERENCES areas(id),
    feature_id uuid REFERENCES features(id)
);

-- blocks
CREATE TABLE IF NOT EXISTS blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    parent_id uuid NOT NULL,
    parent_type character varying(50) NOT NULL,
    type character varying(50) NOT NULL,
    content jsonb DEFAULT '{}'::jsonb,
    order_index integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

-- brain_config
CREATE TABLE IF NOT EXISTS brain_config (
    key character varying(100) NOT NULL PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);

-- cecelia_events
CREATE TABLE IF NOT EXISTS cecelia_events (
    id serial PRIMARY KEY,
    event_type text NOT NULL,
    source text,
    payload jsonb,
    created_at timestamp without time zone DEFAULT now()
);

-- daily_logs
CREATE TABLE IF NOT EXISTS daily_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    date date NOT NULL,
    summary text,
    highlights text[],
    challenges text[],
    mood character varying(20),
    energy_level integer,
    tags text[],
    created_at timestamp without time zone DEFAULT now(),
    project_id uuid REFERENCES projects(id)
);

-- decision_log
CREATE TABLE IF NOT EXISTS decision_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    trigger text,
    input_summary text,
    llm_output_json jsonb,
    action_result_json jsonb,
    status text,
    created_at timestamp without time zone DEFAULT now(),
    ts timestamp without time zone DEFAULT now()
);

-- working_memory
CREATE TABLE IF NOT EXISTS working_memory (
    key text NOT NULL PRIMARY KEY,
    value_json jsonb,
    updated_at timestamp without time zone DEFAULT now()
);

-- reflections
CREATE TABLE IF NOT EXISTS reflections (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    type character varying(20) NOT NULL,
    project_id uuid REFERENCES projects(id),
    source_task_id uuid REFERENCES tasks(id),
    source_goal_id uuid REFERENCES goals(id),
    title character varying(200) NOT NULL,
    content text,
    tags text[],
    created_at timestamp without time zone DEFAULT now()
);

-- pending_actions
CREATE TABLE IF NOT EXISTS pending_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    action_type text NOT NULL,
    params jsonb,
    context jsonb,
    decision_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    status text DEFAULT 'pending_approval',
    reviewed_by text,
    reviewed_at timestamp without time zone,
    execution_result jsonb,
    expires_at timestamp without time zone DEFAULT (now() + interval '24 hours')
);

-- project_kr_links
CREATE TABLE IF NOT EXISTS project_kr_links (
    project_id uuid NOT NULL REFERENCES projects(id),
    kr_id uuid NOT NULL REFERENCES goals(id),
    created_at timestamp without time zone DEFAULT now(),
    PRIMARY KEY (project_id, kr_id)
);

-- Basic indexes
CREATE INDEX IF NOT EXISTS idx_blocks_parent ON blocks(parent_id, parent_type);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_id);
CREATE INDEX IF NOT EXISTS idx_cecelia_events_type_time ON cecelia_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reflections_type ON reflections(type);
