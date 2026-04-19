-- Migration 236: Harness v2 新表 initiative_contracts
-- PRD: docs/design/harness-v2-prd.md §4.2
-- 用途：Initiative 级合同 SSOT（PRD 内容 + 合同正文 + E2E 验收 + 预算/超时）
-- Alex 指示：不加 FK 到 projects（projects 表不保证每个 initiative_id 都有行）

CREATE TABLE IF NOT EXISTS initiative_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','superseded')),
  prd_content TEXT,
  contract_content TEXT,
  e2e_acceptance JSONB,
  budget_cap_usd NUMERIC(8,2) DEFAULT 10,
  timeout_sec INT DEFAULT 21600,                 -- 6h
  review_rounds INT DEFAULT 0,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (initiative_id, version)
);

CREATE INDEX IF NOT EXISTS idx_initiative_contracts_initiative
  ON initiative_contracts(initiative_id, status);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('236', 'Harness v2: initiative_contracts 表（PRD/合同 SSOT + E2E 验收）', NOW())
ON CONFLICT (version) DO NOTHING;
