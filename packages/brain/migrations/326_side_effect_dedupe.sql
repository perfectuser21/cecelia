-- packages/brain/migrations/326_side_effect_dedupe.sql
-- 协议卫生包：副作用短期去重表（建任务/spawn/发通知 三入口 DB 级幂等）
-- 语义：claim 即占位；过期行可被重占（ON CONFLICT DO UPDATE WHERE expired），无独立清理循环。
CREATE TABLE IF NOT EXISTS side_effect_dedupe (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  dedupe_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (kind, dedupe_key)
);

COMMENT ON TABLE side_effect_dedupe IS '副作用幂等短期去重（协议卫生包）：kind=create_task|spawn|notify';
