-- Migration 059: Task Runs 任务执行数据收集
-- Version: 059
-- Date: 2026-02-23
-- Description: 创建 task_runs 表收集任务执行数据

-- task_runs 表：记录任务执行详情
CREATE TABLE IF NOT EXISTS task_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    run_id text NOT NULL,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    ended_at timestamp with time zone,
    status text NOT NULL DEFAULT 'running',
    -- status: running, success, failed, timeout, cancelled
    result jsonb DEFAULT '{}'::jsonb,
    context jsonb DEFAULT '{}'::jsonb,
    -- context: agent, skill, model, provider, repo_path, prompt_summary 等
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_runs_run_id ON task_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_started_at ON task_runs(started_at);

-- schema version
INSERT INTO schema_version (version, description)
VALUES ('059', 'Task runs execution data collection')
ON CONFLICT (version) DO NOTHING;
