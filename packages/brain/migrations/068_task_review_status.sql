-- Migration 068: tasks.review_status - 部门主管验收字段
--
-- 功能：记录任务的验收状态，供 repo-lead 主管审批使用
-- review_status 值：'pending' | 'approved' | 'rejected'
-- reviewed_by: 验收人标识（如 'repo-lead:zenithjoy'）
-- review_feedback: 打回时的反馈内容

-- ============================================================
-- 1. Add review_status column
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'pending';

-- ============================================================
-- 2. Add reviewed_by column
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- ============================================================
-- 3. Add review_feedback column
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_feedback TEXT;

-- ============================================================
-- 4. Index for querying by review_status
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tasks_review_status ON tasks (review_status);

-- ============================================================
-- 5. Update schema version
-- ============================================================
INSERT INTO schema_version (version, description)
VALUES ('068', 'tasks.review_status / reviewed_by / review_feedback - 部门主管验收字段')
ON CONFLICT (version) DO NOTHING;
