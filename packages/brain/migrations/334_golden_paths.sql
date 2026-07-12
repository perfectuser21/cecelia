-- Migration 334: golden_paths 表——GP 蓝图级实体 + 10态状态机
-- 注意：此表与任务级 FR 台账 golden_path 表（九要素 T2 在写）是两个不同实体，既有表零改动。
-- 依据 decisions cb6be3f6（七解法）/ b416bfb3（报备制分层）。

CREATE TABLE golden_paths (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  one_liner        text NOT NULL,
  journey_id       uuid REFERENCES journeys(id),
  kr_id            uuid,
  est_scale        text,
  status           text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','proposed','converged','approved','in_dev',
                      'delivered','expired','rejected','blocked_gate','superseded')),
  source           text NOT NULL DEFAULT 'strategist'
    CHECK (source IN ('strategist','alex_direct','capture_triage')),
  proposal_doc     text,
  demo_url         text,
  judgment_refs    uuid[],
  findings_log     jsonb DEFAULT '[]',
  auto_release     boolean DEFAULT false,
  veto_deadline    timestamptz,
  approved_at      timestamptz,
  review_after     timestamptz,
  status_reason    text,
  proposal_task_id uuid REFERENCES tasks(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_golden_paths_status ON golden_paths(status);
CREATE INDEX idx_golden_paths_journey_id ON golden_paths(journey_id);
CREATE INDEX idx_golden_paths_auto_release ON golden_paths(auto_release) WHERE auto_release = true;
