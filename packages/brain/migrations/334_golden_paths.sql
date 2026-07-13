-- Migration 334: golden_paths — GP 蓝图级提案实体 + 生命周期状态机（GP loop T1）
-- 设计 SSOT: docs/architecture/2026-07-12-golden-path-mode/architecture.md（字段清单勿改）
-- 注意：与既有 golden_path（单数，任务级累积 FR 台账，migration 303）是两个实体，互不影响。

CREATE TABLE IF NOT EXISTS golden_paths (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  one_liner     text NOT NULL,
  journey_id    uuid REFERENCES journeys(id),
  kr_id         uuid,
  est_scale     text,
  status        text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','proposed','converged','approved','in_dev',
                      'delivered','expired','rejected','blocked_gate','superseded')),
  source        text NOT NULL DEFAULT 'strategist'
    CHECK (source IN ('strategist','alex_direct','capture_triage')),
  proposal_doc  text,
  demo_url      text,
  judgment_refs uuid[],
  findings_log  jsonb DEFAULT '[]',
  auto_release  boolean DEFAULT false,
  veto_deadline timestamptz,
  approved_at   timestamptz,
  review_after  timestamptz,
  status_reason text,
  proposal_task_id uuid REFERENCES tasks(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_golden_paths_status ON golden_paths(status);

COMMENT ON TABLE golden_paths IS 'GP 蓝图级提案实体（10 态生命周期状态机）——区别于 golden_path（任务级累积FR台账）';
COMMENT ON COLUMN golden_paths.auto_release IS '报备制（b416bfb3 五条件）：true 时走 24h 否决窗';
COMMENT ON COLUMN golden_paths.review_after IS '保质期：默认 approved_at + 14 天，超期未 in_dev 由 gp-shelf-life 置 expired';
