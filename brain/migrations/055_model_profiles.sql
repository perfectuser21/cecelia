-- 055_model_profiles.sql
-- 模型 Profile 运行时切换系统
-- 支持在后台一键切换 LLM 模型配置

CREATE TABLE IF NOT EXISTS model_profiles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL UNIQUE,
  config JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 确保只有一个 active profile
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_profiles_active
  ON model_profiles (is_active) WHERE is_active = true;

-- Seed: Profile A - MiniMax 主力（默认激活）
INSERT INTO model_profiles (id, name, config, is_active) VALUES
('profile-minimax', 'MiniMax 主力', '{
  "thalamus": {
    "provider": "minimax",
    "model": "MiniMax-M2.1"
  },
  "cortex": {
    "provider": "anthropic",
    "model": "claude-opus-4-20250514"
  },
  "executor": {
    "default_provider": "minimax",
    "model_map": {
      "dev":           { "anthropic": null,         "minimax": "MiniMax-M2.5-highspeed" },
      "exploratory":   { "anthropic": null,         "minimax": "MiniMax-M2.1" },
      "review":        { "anthropic": null,         "minimax": "MiniMax-M2.5-highspeed" },
      "qa":            { "anthropic": null,         "minimax": "MiniMax-M2.5-highspeed" },
      "audit":         { "anthropic": null,         "minimax": "MiniMax-M2.5-highspeed" },
      "talk":          { "anthropic": null,         "minimax": "MiniMax-M2.5-highspeed" },
      "research":      { "anthropic": null,         "minimax": "MiniMax-M2.5-highspeed" },
      "decomp_review": { "anthropic": null,         "minimax": "MiniMax-M2.5-highspeed" },
      "codex_qa":      { "anthropic": null,         "minimax": null }
    },
    "fixed_provider": {
      "exploratory":   "minimax",
      "codex_qa":      "openai",
      "decomp_review": "minimax",
      "talk":          "minimax",
      "research":      "minimax"
    }
  }
}'::jsonb, true)
ON CONFLICT (id) DO NOTHING;

-- Seed: Profile B - Anthropic 主力（未激活）
INSERT INTO model_profiles (id, name, config, is_active) VALUES
('profile-anthropic', 'Anthropic 主力', '{
  "thalamus": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001"
  },
  "cortex": {
    "provider": "anthropic",
    "model": "claude-opus-4-20250514"
  },
  "executor": {
    "default_provider": "anthropic",
    "model_map": {
      "dev":           { "anthropic": "claude-sonnet-4-20250514", "minimax": null },
      "exploratory":   { "anthropic": "claude-sonnet-4-20250514", "minimax": null },
      "review":        { "anthropic": "claude-sonnet-4-20250514", "minimax": null },
      "qa":            { "anthropic": "claude-sonnet-4-20250514", "minimax": null },
      "audit":         { "anthropic": "claude-sonnet-4-20250514", "minimax": null },
      "talk":          { "anthropic": "claude-sonnet-4-20250514", "minimax": null },
      "research":      { "anthropic": "claude-sonnet-4-20250514", "minimax": null },
      "decomp_review": { "anthropic": "claude-sonnet-4-20250514", "minimax": null },
      "codex_qa":      { "anthropic": null,                        "minimax": null }
    },
    "fixed_provider": {
      "codex_qa": "openai"
    }
  }
}'::jsonb, false)
ON CONFLICT (id) DO NOTHING;

-- 更新 schema_version
INSERT INTO schema_version (version) VALUES ('055')
ON CONFLICT (version) DO NOTHING;
