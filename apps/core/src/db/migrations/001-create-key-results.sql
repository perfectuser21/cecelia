-- Create key_results table for OKR Key Results
CREATE TABLE IF NOT EXISTS key_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  target_value NUMERIC,
  current_value NUMERIC DEFAULT 0,
  unit TEXT,
  status TEXT DEFAULT 'on_track',
  priority TEXT,
  expected_completion_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index on goal_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_key_results_goal_id ON key_results(goal_id);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_key_results_status ON key_results(status);
