-- Cecelia Task Database Schema
-- SQLite3 数据库，作为 VPS 本地的"大脑记忆"

-- ============================================
-- 1. Areas（领域）
-- ============================================
CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,              -- 如：work, personal, health
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,                       -- Notion 颜色
  icon TEXT,                        -- Emoji icon
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived BOOLEAN DEFAULT 0
);

CREATE INDEX idx_areas_archived ON areas(archived);

-- ============================================
-- 2. Projects（项目）
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,              -- 如：cecelia-quality, zenithjoy-engine
  area_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',     -- active, paused, completed, archived
  priority TEXT DEFAULT 'P2',       -- P0, P1, P2, P3
  repo_path TEXT,                   -- 仓库路径
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL
);

CREATE INDEX idx_projects_area ON projects(area_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_priority ON projects(priority);

-- ============================================
-- 3. Tasks（任务）
-- ============================================
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,              -- UUID
  project_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'inbox',      -- inbox, todo, doing, blocked, done, cancelled
  priority TEXT DEFAULT 'P2',       -- P0, P1, P2, P3
  intent TEXT,                      -- runQA, fixBug, refactor, review, summarize, optimizeSelf
  payload TEXT,                     -- JSON payload
  prd_path TEXT,                    -- 如果有 PRD 文件路径
  branch TEXT,                      -- Git 分支
  pr_url TEXT,                      -- PR URL（完成后）
  due_date TEXT,                    -- ISO 8601
  tags TEXT,                        -- JSON array
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_intent ON tasks(intent);
CREATE INDEX idx_tasks_created ON tasks(created_at DESC);

-- ============================================
-- 4. Runs（执行记录）
-- ============================================
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,              -- Run UUID
  task_id TEXT NOT NULL,
  status TEXT DEFAULT 'queued',     -- queued, running, succeeded, failed, timeout, cancelled
  intent TEXT NOT NULL,
  priority TEXT NOT NULL,
  worker_pid INTEGER,               -- Worker 进程 ID
  workspace_path TEXT,              -- 工作目录（worktree）
  started_at TEXT,
  completed_at TEXT,
  duration_seconds INTEGER,
  exit_code INTEGER,
  error_message TEXT,
  summary_path TEXT,                -- runs/<runId>/summary.json
  log_path TEXT,                    -- runs/<runId>/worker.log
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_runs_task ON runs(task_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_created ON runs(created_at DESC);

-- ============================================
-- 5. Evidence（证据）
-- ============================================
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,              -- UUID
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,               -- qa_report, audit_report, test_result, screenshot, log
  file_path TEXT NOT NULL,          -- 相对于 runs/<runId>/evidence/
  description TEXT,
  size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_evidence_run ON evidence(run_id);
CREATE INDEX idx_evidence_task ON evidence(task_id);
CREATE INDEX idx_evidence_type ON evidence(type);

-- ============================================
-- 6. Inbox（收件箱）
-- ============================================
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,              -- UUID
  source TEXT NOT NULL,             -- notion, cloudcode, n8n, webhook, heartbeat
  raw_payload TEXT NOT NULL,        -- 原始 JSON
  processed BOOLEAN DEFAULT 0,
  task_id TEXT,                     -- 处理后生成的 task_id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,

  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX idx_inbox_processed ON inbox(processed);
CREATE INDEX idx_inbox_source ON inbox(source);
CREATE INDEX idx_inbox_created ON inbox(created_at DESC);

-- ============================================
-- 7. System State（系统状态）
-- ============================================
CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,             -- 如：last_heartbeat, queue_length, health
  value TEXT NOT NULL,              -- JSON value
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 预填充一些关键状态
INSERT OR IGNORE INTO system_state (key, value) VALUES
  ('health', '"ok"'),
  ('queue_length', '0'),
  ('last_heartbeat', 'null'),
  ('last_sync_notion', 'null'),
  ('total_tasks', '0'),
  ('total_runs', '0');

-- ============================================
-- 8. Notion Sync（Notion 同步记录）
-- ============================================
CREATE TABLE IF NOT EXISTS notion_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,        -- task, run, state
  entity_id TEXT NOT NULL,          -- 本地 ID
  notion_page_id TEXT,              -- Notion Page ID
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'pending', -- pending, synced, error
  error_message TEXT,

  UNIQUE(entity_type, entity_id)
);

CREATE INDEX idx_notion_sync_entity ON notion_sync(entity_type, entity_id);
CREATE INDEX idx_notion_sync_status ON notion_sync(sync_status);

-- ============================================
-- Views（视图）
-- ============================================

-- 活跃任务视图
CREATE VIEW IF NOT EXISTS active_tasks AS
SELECT
  t.*,
  p.name as project_name,
  p.repo_path,
  (SELECT COUNT(*) FROM runs WHERE task_id = t.id) as run_count,
  (SELECT status FROM runs WHERE task_id = t.id ORDER BY created_at DESC LIMIT 1) as last_run_status
FROM tasks t
LEFT JOIN projects p ON t.project_id = p.id
WHERE t.status IN ('inbox', 'todo', 'doing', 'blocked')
ORDER BY
  CASE t.priority
    WHEN 'P0' THEN 0
    WHEN 'P1' THEN 1
    WHEN 'P2' THEN 2
    WHEN 'P3' THEN 3
  END,
  t.created_at ASC;

-- 最近运行视图
CREATE VIEW IF NOT EXISTS recent_runs AS
SELECT
  r.*,
  t.title as task_title,
  t.project_id,
  p.name as project_name
FROM runs r
JOIN tasks t ON r.task_id = t.id
LEFT JOIN projects p ON t.project_id = p.id
ORDER BY r.created_at DESC
LIMIT 100;

-- 系统健康视图
CREATE VIEW IF NOT EXISTS system_health AS
SELECT
  (SELECT COUNT(*) FROM tasks WHERE status = 'inbox') as inbox_count,
  (SELECT COUNT(*) FROM tasks WHERE status = 'todo') as todo_count,
  (SELECT COUNT(*) FROM tasks WHERE status = 'doing') as doing_count,
  (SELECT COUNT(*) FROM tasks WHERE status = 'blocked') as blocked_count,
  (SELECT COUNT(*) FROM tasks WHERE status = 'done') as done_count,
  (SELECT COUNT(*) FROM runs WHERE status = 'queued') as queued_runs,
  (SELECT COUNT(*) FROM runs WHERE status = 'running') as running_runs,
  (SELECT COUNT(*) FROM runs WHERE status = 'failed' AND created_at > datetime('now', '-24 hours')) as failed_24h,
  (SELECT value FROM system_state WHERE key = 'health') as health,
  (SELECT value FROM system_state WHERE key = 'last_heartbeat') as last_heartbeat;
