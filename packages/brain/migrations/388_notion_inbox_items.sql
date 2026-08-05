-- Migration 388: notion_inbox_items — F5 呈报+裁决窄口台账
--
-- 记录从 Brain 推送到 Notion 个人收件箱的条目，以及主理人裁决回读状态。
-- 幂等锚点：idempotency_key UNIQUE
--
-- source_type: capture_atom | morning_report | contract
-- status: pending → pushed → consumed | failed
-- verdict: approve(✅放行) | reject(❌不放行) | comment(✏️批注)

CREATE TABLE IF NOT EXISTS notion_inbox_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type      text        NOT NULL CHECK (source_type IN ('capture_atom', 'morning_report', 'contract')),
  source_id        text        NOT NULL,
  notion_page_id   text        UNIQUE,
  ai_summary       text,
  suggested_dir    text,
  confidence       numeric(3,2),
  needs_approval   boolean     NOT NULL DEFAULT false,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'pushed', 'consumed', 'failed')),
  verdict          text        CHECK (verdict IN ('approve', 'reject', 'comment')),
  verdict_comment  text,
  consumed_at      timestamptz,
  pushed_at        timestamptz,
  idempotency_key  text        NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notion_inbox_items_status_idx
  ON notion_inbox_items (status)
  WHERE status IN ('pending', 'pushed');

CREATE INDEX IF NOT EXISTS notion_inbox_items_source_idx
  ON notion_inbox_items (source_type, source_id);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('388', 'notion_inbox_items — F5 呈报+裁决窄口台账', NOW())
ON CONFLICT (version) DO NOTHING;
