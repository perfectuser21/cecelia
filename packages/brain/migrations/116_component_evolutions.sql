-- Migration 116: Cecelia 进化日志系统
-- component_evolutions: 每次 PR 合并的原始记录
-- component_evolution_summaries: 皮层周期合成的叙事

CREATE TABLE IF NOT EXISTS component_evolutions (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  component VARCHAR(50) NOT NULL,
  pr_number INT,
  title TEXT NOT NULL,
  significance INT NOT NULL DEFAULT 3 CHECK (significance BETWEEN 1 AND 5),
  summary TEXT,
  changed_files TEXT[],
  version VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_component_evolutions_component ON component_evolutions(component);
CREATE INDEX IF NOT EXISTS idx_component_evolutions_date ON component_evolutions(date DESC);

CREATE TABLE IF NOT EXISTS component_evolution_summaries (
  id SERIAL PRIMARY KEY,
  component VARCHAR(50) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  narrative TEXT NOT NULL,
  pr_count INT NOT NULL DEFAULT 0,
  key_milestones TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evolution_summaries_component ON component_evolution_summaries(component);
CREATE INDEX IF NOT EXISTS idx_evolution_summaries_period ON component_evolution_summaries(period_end DESC);
