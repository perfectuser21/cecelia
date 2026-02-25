-- Migration 010: Plan Proposal system
-- Adds proposals table for structured planning proposals (LLM or user-generated).
-- Proposals contain changes that are validated, approved, then applied to tasks/goals.

CREATE TABLE IF NOT EXISTS proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source varchar(20) NOT NULL CHECK (source IN ('llm_proposal', 'user_ui')),
  type varchar(30) NOT NULL DEFAULT 'reorder' CHECK (type IN ('project_plan', 'reorder', 'optimization')),
  scope varchar(20) CHECK (scope IN ('objective', 'kr', 'project', 'feature')),
  scope_id uuid,
  title text NOT NULL,
  description text,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot jsonb,
  risk_level varchar(10) NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  status varchar(20) NOT NULL DEFAULT 'pending_review' CHECK (status IN ('draft', 'pending_review', 'approved', 'applied', 'rejected', 'rolled_back')),
  approved_at timestamp,
  approved_by varchar(100),
  applied_at timestamp,
  rolled_back_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals (status);
CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals (created_at DESC);

-- Update schema version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('010', 'Plan Proposal system', NOW())
ON CONFLICT (version) DO NOTHING;
