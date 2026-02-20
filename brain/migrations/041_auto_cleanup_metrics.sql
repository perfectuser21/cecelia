-- Migration 041: Auto-cleanup functions for high-volume metrics tables
-- Keeps alertness_metrics (3 days), decision_log (7 days), cecelia_events (7 days), decisions (30 days)

-- Function: cleanup alertness_metrics (keep 3 days)
CREATE OR REPLACE FUNCTION cleanup_alertness_metrics(retain_days INTEGER DEFAULT 3)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM alertness_metrics
  WHERE "timestamp" < NOW() - (retain_days || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function: cleanup decision_log (keep 7 days)
CREATE OR REPLACE FUNCTION cleanup_decision_log(retain_days INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM decision_log
  WHERE created_at < NOW() - (retain_days || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function: cleanup cecelia_events (keep 7 days)
CREATE OR REPLACE FUNCTION cleanup_cecelia_events(retain_days INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cecelia_events'
  ) THEN
    DELETE FROM cecelia_events
    WHERE created_at < NOW() - (retain_days || ' days')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSE
    deleted_count := 0;
  END IF;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function: cleanup decisions (keep 30 days)
CREATE OR REPLACE FUNCTION cleanup_decisions(retain_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'decisions'
  ) THEN
    DELETE FROM decisions
    WHERE created_at < NOW() - (retain_days || ' days')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSE
    deleted_count := 0;
  END IF;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Master cleanup function: run all cleanups
CREATE OR REPLACE FUNCTION run_periodic_cleanup()
RETURNS TEXT AS $$
DECLARE
  n1 INTEGER;
  n2 INTEGER;
  n3 INTEGER;
  n4 INTEGER;
BEGIN
  SELECT cleanup_alertness_metrics(3) INTO n1;
  SELECT cleanup_decision_log(7) INTO n2;
  SELECT cleanup_cecelia_events(7) INTO n3;
  SELECT cleanup_decisions(30) INTO n4;
  RETURN format('cleanup done: alertness_metrics=%s, decision_log=%s, cecelia_events=%s, decisions=%s', n1, n2, n3, n4);
END;
$$ LANGUAGE plpgsql;

-- Record migration
INSERT INTO schema_version (version, description, applied_at)
VALUES ('041', 'Add auto-cleanup functions for alertness_metrics, decision_log, cecelia_events, decisions', NOW())
ON CONFLICT (version) DO NOTHING;
