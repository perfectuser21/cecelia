-- Migration 318: Skill Evaluator 内部验收台
-- Sprint: 07072314-skill-eval-service
-- 建立 skill_evals 表，支持员工 zip 上传、单 slot 队列评估、报告发布

CREATE TABLE IF NOT EXISTS skill_evals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id),
  zip_hash TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  source_platform TEXT,
  submitter TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,
  report_url TEXT,
  queue_position INTEGER,
  staging_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- status 合法值：pending / running / completed / failed
-- 注：使用应用层约束而非 CHECK 约束，便于后续扩展状态

CREATE INDEX IF NOT EXISTS skill_evals_zip_hash_idx ON skill_evals(zip_hash);
CREATE INDEX IF NOT EXISTS skill_evals_status_idx ON skill_evals(status);
CREATE INDEX IF NOT EXISTS skill_evals_task_id_idx ON skill_evals(task_id);
CREATE INDEX IF NOT EXISTS skill_evals_created_at_idx ON skill_evals(created_at DESC);
