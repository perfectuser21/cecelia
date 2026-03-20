-- Migration 165: Add Scope layer between Project and Initiative
-- Scope = 2-3 day functional boundary grouping (Shape Up methodology)
-- Hierarchy: Project (1 week) → Scope (2-3 days) → Initiative (1-2 hours)

-- Update decomposition_depth to support 3 levels:
--   0 = project
--   1 = scope (NEW)
--   2 = initiative
-- Note: projects.type has no CHECK constraint, 'scope' is valid immediately

-- Update existing initiatives to depth=2 (previously depth=1)
UPDATE projects SET decomposition_depth = 2 WHERE type = 'initiative' AND decomposition_depth = 1;

-- Add comment for documentation
COMMENT ON COLUMN projects.decomposition_depth IS '0=project, 1=scope, 2=initiative';
