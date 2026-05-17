-- Migration 241: dev_reviews — Phase 8.3 Structured Review Block 落地
-- 存储 proxy 生成的自审 review（B-4/B-5/B-6/SDD-2/SDD-3 五个点）
-- 依据：docs/superpowers/specs/2026-04-20-phase83-dev-reviews-design.md

CREATE TABLE IF NOT EXISTS dev_reviews (
    id                  SERIAL PRIMARY KEY,
    pr_number           INTEGER,
    branch              TEXT,
    point_code          TEXT NOT NULL,
    decision            TEXT NOT NULL,
    confidence          TEXT NOT NULL,
    quality_score       INTEGER NOT NULL CHECK (quality_score BETWEEN 0 AND 10),
    risks               JSONB DEFAULT '[]'::jsonb,
    anchors_user_words  TEXT,
    anchors_code        TEXT,
    anchors_okr         TEXT,
    next_step           TEXT,
    raw_markdown        TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_reviews_pr ON dev_reviews(pr_number);
CREATE INDEX IF NOT EXISTS idx_dev_reviews_point ON dev_reviews(point_code);
CREATE INDEX IF NOT EXISTS idx_dev_reviews_created ON dev_reviews(created_at DESC);

COMMENT ON TABLE dev_reviews IS 'Phase 8.3: Structured Review Block 存储 — /dev 自审点（B-4/B-5/B-6/SDD-2/SDD-3）的打分与决策';
COMMENT ON COLUMN dev_reviews.point_code IS 'Superpowers 交互点代号';
COMMENT ON COLUMN dev_reviews.decision IS 'APPROVE / REQUEST_CHANGES / PASS_WITH_CONCERNS';
COMMENT ON COLUMN dev_reviews.confidence IS 'HIGH / MEDIUM / LOW';
COMMENT ON COLUMN dev_reviews.quality_score IS '0-10';
COMMENT ON COLUMN dev_reviews.risks IS 'JSONB array of {risk, impact}';
