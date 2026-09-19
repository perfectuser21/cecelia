-- 449: 模型账号配额+机器可达性快照表（工厂·F5 指挥舱 刀2）
-- 8 个静态模型账号（Claude Code x2 + Codex team x5 + Grok）的实时配额快照。
-- collector 每 5min 幂等 upsert（ON CONFLICT (account_id) DO UPDATE）；端点只读全表投影。
-- account_id 为身份键（主键，唯一）；单账号失败以 status + last_error 双写，不阻塞整体。
CREATE TABLE IF NOT EXISTS ops_model_accounts (
  account_id      TEXT PRIMARY KEY,                 -- 身份键，8 个静态账号各唯一
  provider        TEXT NOT NULL,                    -- claude / codex / grok
  plan            TEXT,                             -- 套餐；查不到=NULL
  five_hour_pct   INTEGER,                          -- 0–100；查不到=NULL（诚实留空，禁编造 0）
  seven_day_pct   INTEGER,
  reset_at        TIMESTAMPTZ,                      -- 配额重置时刻
  host_alias      TEXT NOT NULL DEFAULT 'mmv',      -- 凭据所在机器，固定 mmv
  forwardable     BOOLEAN NOT NULL DEFAULT FALSE,   -- 静态配置：能否借道转发
  forward_targets JSONB NOT NULL DEFAULT '[]'::jsonb, -- 静态配置：转发目标机（Codex=[xian-m4,xian-m1]；Claude/Grok=[]）
  status          TEXT NOT NULL DEFAULT 'unknown',  -- ok | unknown | key_expired | no_credential
  last_error      TEXT,                             -- 失败原文（写入前截断 ≤500），与 status 双写
  last_checked_at TIMESTAMPTZ,                      -- 最近采集时刻
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
