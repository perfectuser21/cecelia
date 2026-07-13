-- Migration 315: 九要素存储 —— action_receipts 台账 + decisions.review_after 列
--
-- 背景（作战循环收尾 P2）：
--   1. action_receipts：给"每个对外动作"配一条效果回执台账。作战循环强调对外动作
--      （sendBark / 飞书 / deploy / pr_merge 等）不能"发出即认为成功"，必须留下可查的
--      回执状态 + 效果证据（对齐 Gate3 部署效果确认的反"假成功"思路）。
--   2. decisions.review_after：给每条决策一个"复盘时点"，到点后应重新审视该决策是否仍有效
--      （决策不是一锤子买卖，需定期 re-evaluate）。

-- ── action_receipts：对外动作效果回执台账 ──
CREATE TABLE IF NOT EXISTS action_receipts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id      UUID,                          -- 关联的动作 / 任务 id（可空，自由关联）
  kind           TEXT NOT NULL,                 -- 动作种类：bark / feishu / deploy / pr_merge / ...
  target         TEXT,                          -- 动作目标：url / channel / host 等
  sent_at        TIMESTAMPTZ DEFAULT NOW(),     -- 动作发出时间
  receipt_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (receipt_status IN ('pending','confirmed','failed','timeout')),
  evidence       JSONB DEFAULT '{}'::jsonb,     -- 效果证据：http code / 截图 url / 版本 / 平台回执 等
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_receipts_kind   ON action_receipts(kind);
CREATE INDEX IF NOT EXISTS idx_action_receipts_status ON action_receipts(receipt_status);
CREATE INDEX IF NOT EXISTS idx_action_receipts_action ON action_receipts(action_id);

COMMENT ON TABLE  action_receipts IS '对外动作效果回执台账（九要素之一）：动作发出后回填真实效果，反"发出即成功"';
COMMENT ON COLUMN action_receipts.receipt_status IS 'pending=已发未确认 / confirmed=效果确认 / failed=确认失败 / timeout=超时未回执';
COMMENT ON COLUMN action_receipts.evidence IS '效果证据 JSON：如 {"http_code":200,"screenshot_url":"...","version":"1.238.3"}';

-- ── decisions.review_after：决策复盘时点 ──
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS review_after TIMESTAMPTZ;

COMMENT ON COLUMN decisions.review_after IS '决策复盘时点：到点后应重新审视该决策是否仍有效（NULL=无需定期复盘）';
