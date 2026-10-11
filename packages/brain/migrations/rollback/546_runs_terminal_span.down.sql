-- 回滚 546：恢复 531 的 spans_rollup_run（按最差结果，无终态 span）。回填改过的运行结果不回退（合并成功本就是 pass）。
BEGIN;

CREATE OR REPLACE FUNCTION spans_rollup_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE runs r SET
    workflow_id = COALESCE(r.workflow_id, NEW.workflow_id),
    tokens_in  = CASE WHEN NEW.tokens_in  IS NULL THEN r.tokens_in  ELSE COALESCE(r.tokens_in, 0)  + NEW.tokens_in  END,
    tokens_out = CASE WHEN NEW.tokens_out IS NULL THEN r.tokens_out ELSE COALESCE(r.tokens_out, 0) + NEW.tokens_out END,
    cost_usd   = CASE WHEN NEW.cost_usd   IS NULL THEN r.cost_usd   ELSE COALESCE(r.cost_usd, 0)   + NEW.cost_usd   END,
    started_at = CASE WHEN r.header_source = 'spans' THEN LEAST(r.started_at, NEW.started_at) ELSE r.started_at END,
    ended_at   = CASE WHEN r.header_source = 'spans' THEN GREATEST(r.ended_at, NEW.ended_at) ELSE r.ended_at END,
    outcome    = CASE WHEN r.header_source <> 'spans' THEN r.outcome
                      WHEN r.outcome = 'fail' OR NEW.outcome = 'fail' THEN 'fail'
                      WHEN r.outcome = 'pass' OR NEW.outcome = 'pass' THEN 'pass'
                      WHEN NEW.outcome = 'skipped' AND r.outcome IN ('running', 'skipped') THEN 'skipped'
                      ELSE 'unknown' END,
    updated_at = now()
  WHERE r.run_id = NEW.run_id;
  RETURN NULL;
END $$;

COMMIT;
