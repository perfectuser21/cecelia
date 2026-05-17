-- Expire stale pending decisions that were never executed
-- These accumulated because retry actions had confidence 0.7 < threshold 0.8
-- After the autonomy fix, safe actions auto-execute regardless of confidence
UPDATE decisions
SET status = 'expired', updated_at = NOW()
WHERE status = 'pending'
  AND created_at < NOW() - INTERVAL '1 hour';
