-- 546: 运行结果以终态 span 为准（金丝雀 4 #6232，父任务 187f8f6e）
-- 531 的 runs 汇总按「最差 span」定结果：coding workflow 的 GAN 中途 QA/裁判 FAIL 轮是迭代的正常部分，
-- 却让合并成功的运行在 Notion「最近执行」显示失败。
-- 新规则：span 带 evidence.run_terminal = true 即本次运行的终态——结果取该 span 的结果，总记录转 owner
-- （此后 span 只往上加 token/费用，不再改结果与起止，同 531 owner 语义）。没有终态 span 的运行照旧按最差结果。
-- 回填：已有合并 pass span 的 coding workflow 运行（runner 在本迁移前合并的）按合并结果改 pass。
BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION spans_rollup_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  terminal boolean := COALESCE(NEW.evidence->>'run_terminal', '') = 'true';
BEGIN
  UPDATE runs r SET
    workflow_id = COALESCE(r.workflow_id, NEW.workflow_id),
    tokens_in  = CASE WHEN NEW.tokens_in  IS NULL THEN r.tokens_in  ELSE COALESCE(r.tokens_in, 0)  + NEW.tokens_in  END,
    tokens_out = CASE WHEN NEW.tokens_out IS NULL THEN r.tokens_out ELSE COALESCE(r.tokens_out, 0) + NEW.tokens_out END,
    cost_usd   = CASE WHEN NEW.cost_usd   IS NULL THEN r.cost_usd   ELSE COALESCE(r.cost_usd, 0)   + NEW.cost_usd   END,
    started_at = CASE WHEN r.header_source = 'spans' THEN LEAST(r.started_at, NEW.started_at) ELSE r.started_at END,
    ended_at   = CASE WHEN r.header_source = 'spans' THEN GREATEST(r.ended_at, NEW.ended_at) ELSE r.ended_at END,
    outcome    = CASE WHEN r.header_source <> 'spans' THEN r.outcome
                      WHEN terminal THEN NEW.outcome
                      WHEN r.outcome = 'fail' OR NEW.outcome = 'fail' THEN 'fail'
                      WHEN r.outcome = 'pass' OR NEW.outcome = 'pass' THEN 'pass'
                      WHEN NEW.outcome = 'skipped' AND r.outcome IN ('running', 'skipped') THEN 'skipped'
                      ELSE 'unknown' END,
    header_source = CASE WHEN terminal AND r.header_source = 'spans' THEN 'owner' ELSE r.header_source END,
    updated_at = now()
  WHERE r.run_id = NEW.run_id;
  RETURN NULL;
END $$;

-- 回填：coding workflow 合并 Activity（迁移 542 固定 id）有 pass span 的运行
UPDATE runs r SET outcome = 'pass', header_source = 'owner', updated_at = now()
WHERE r.run_id LIKE 'coding-workflow:%'
  AND r.header_source = 'spans'
  AND r.outcome <> 'pass'
  AND EXISTS (SELECT 1 FROM spans s WHERE s.run_id = r.run_id AND s.activity_id = 'c0de0000-0000-4000-8000-00000000010c' AND s.outcome = 'pass');

COMMIT;
