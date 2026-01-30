-- TRD Decomposition Tables Migration
-- Stage 2: TRD Decomposer
-- Note: Uses trd_decompositions to avoid conflict with existing trds table

-- TRD decomposition table to store decomposed Technical Requirements Documents
CREATE TABLE IF NOT EXISTS trd_decompositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  project_id UUID,
  goal_id UUID,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- TRD-Task relation table
CREATE TABLE IF NOT EXISTS trd_decomposition_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trd_id UUID REFERENCES trd_decompositions(id) ON DELETE CASCADE,
  task_id UUID,
  milestone VARCHAR(255),
  prd_title VARCHAR(255),
  sequence_order INT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_trd_decomposition_tasks_trd_id ON trd_decomposition_tasks(trd_id);
CREATE INDEX IF NOT EXISTS idx_trd_decomposition_tasks_task_id ON trd_decomposition_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_trd_decompositions_project_id ON trd_decompositions(project_id);
CREATE INDEX IF NOT EXISTS idx_trd_decompositions_goal_id ON trd_decompositions(goal_id);
