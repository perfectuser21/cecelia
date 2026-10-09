-- 433: ops 运行舱只读投影（指挥舱 G1 S1 加厚刀1，task 6fcb5356 / gp 804520f5 / 决策 1f4fbc0f）
-- 注意：agent_ops_agents(274) 是 Path4 微信 RPA 专用表（CHECK 枚举+275 外键），本迁移与其无关、不得复用。
CREATE TABLE IF NOT EXISTS ops_agents (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,            -- brain | openclaw | launchd
  host_alias TEXT NOT NULL,        -- local / hk-vps / mmv / xian-* …自由文本
  name TEXT NOT NULL,
  agent_type TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- active | offline
  last_seen_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}',        -- 白名单字段，禁整份外部 config（含凭据）
  notion_id TEXT,
  notion_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, host_alias, name)        -- 跨机器同名不互撞
);

CREATE TABLE IF NOT EXISTS ops_schedule_entries (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  host_alias TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,              -- launchd_interval | launchd_calendar | gha_cron | brain_recurring
  schedule_desc TEXT NOT NULL DEFAULT '',
  next_run_utc TIMESTAMPTZ,        -- 算不准=NULL，禁假精确
  last_state TEXT,
  last_exit_code INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,    -- 快照缺席→false（保留 notion_id 防重建页）
  notion_id TEXT,
  notion_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, host_alias, label)
);

CREATE TABLE IF NOT EXISTS ops_source_heartbeats (
  source TEXT NOT NULL,
  host_alias TEXT NOT NULL,
  last_report_at TIMESTAMPTZ,      -- 服务端时钟（stale 判定唯一基线）
  last_collected_at TIMESTAMPTZ,   -- 采集时间戳（单调守卫+展示）
  source_status TEXT NOT NULL DEFAULT 'never', -- ok|unreachable|parse_error|config_missing|schema_drift
  reason_code TEXT,
  last_error TEXT,                 -- 人可读原文（截断），与 reason_code 双写
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, host_alias)
);
