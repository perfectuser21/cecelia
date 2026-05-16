-- Migration 276: 发布成功率历史趋势表
-- 目标：将 working_memory.daily_publish_stats（每日覆盖）升级为可查历史的时序表
-- 写入点：publish-monitor.js monitorPublishQueue() 每次 tick 幂等 UPSERT

CREATE TABLE IF NOT EXISTS publish_success_daily (
    id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    date        DATE        NOT NULL,
    platform    TEXT        NOT NULL,   -- 平台名；'__all__' = 全平台汇总行
    total       INTEGER     NOT NULL DEFAULT 0,
    completed   INTEGER     NOT NULL DEFAULT 0,
    failed      INTEGER     NOT NULL DEFAULT 0,
    queued      INTEGER     NOT NULL DEFAULT 0,
    in_progress INTEGER     NOT NULL DEFAULT 0,
    success_rate NUMERIC(5,2),          -- 百分比 0-100，NULL 表示当日无发布记录
    coverage    INTEGER,               -- 仅 platform='__all__' 行有效：有 completed 的平台数
    created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
    CONSTRAINT publish_success_daily_date_platform_uq UNIQUE (date, platform)
);

CREATE INDEX IF NOT EXISTS publish_success_daily_date_idx      ON publish_success_daily (date DESC);
CREATE INDEX IF NOT EXISTS publish_success_daily_platform_idx  ON publish_success_daily (platform);

COMMENT ON TABLE publish_success_daily IS
  '按 platform × date 粒度存储每日发布成功率历史，用于趋势分析和告警。每 tick 幂等 UPSERT（约 5 分钟一次），全平台汇总用 platform=''__all__''，各平台明细用平台名。';

COMMENT ON COLUMN publish_success_daily.platform IS
  '平台标识符（wechat/douyin/xiaohongshu 等）；特殊值 ''__all__'' 表示全平台汇总行。';

COMMENT ON COLUMN publish_success_daily.success_rate IS
  '完成率 = completed / (completed + failed) * 100，四舍五入到整数，无发布记录时为 NULL。';

COMMENT ON COLUMN publish_success_daily.coverage IS
  '仅全平台汇总行（platform=''__all__''）有效：当日至少完成 1 次发布的平台数量。';
