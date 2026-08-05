-- 389: journeys 正式分区字段 biz_area + 一次性归位 + smoke 残渣清库
-- Alex 2026-08-05 拍板：军师台/战情室分区不许靠名字正则猜；
-- 智能客服全家/AI爆款视频翻拍/Agent hardening 属 ZenithJoy；西安机群单列 infrastructure；
-- [smoke]/gp-agg-smoke/Smoke Journey D 测试残渣打 deprecated（不再前端遮）。
-- 任务 82830303。

ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS biz_area TEXT
  CHECK (biz_area IS NULL OR biz_area IN ('cecelia', 'zenithjoy', 'infrastructure'));

COMMENT ON COLUMN journeys.biz_area IS '业务分区三桶（cecelia=系统自身/工厂域, zenithjoy=对客业务, infrastructure=机群网络底座）；渲染分组一等字段，正则仅存量兜底';

-- ── 一次性归位（按 2026-08-05 拍板名单）───────────────────────────────────────

-- ZenithJoy：对客业务全家
UPDATE journeys SET biz_area = 'zenithjoy'
WHERE biz_area IS NULL AND (
  name LIKE '智能客服%'
  OR name IN (
    '客户私域 AI 接管', 'AI 爆款视频翻拍', 'Agent 系统 hardening',
    'ZenithJoy 客户管理', 'ZenithJoy 运营中枢', '智能发布', '视频剪辑',
    '客户智能获客路径', '客户首次成功路径'
  )
  OR name LIKE 'MJ3 %'  -- 主理人内容创作闭环 = content pipeline（对客内容业务侧，残渣待归位但桶先归对）
);

-- Infrastructure：机群/网络底座
UPDATE journeys SET biz_area = 'infrastructure'
WHERE biz_area IS NULL AND name LIKE '西安机群%';

-- Cecelia：工厂域 + 系统自身
UPDATE journeys SET biz_area = 'cecelia'
WHERE biz_area IS NULL AND (
  name LIKE '工厂 %' OR name LIKE '工厂·%' OR name LIKE 'MJ%'
  OR name = 'Cecelia Harness Pipeline'
);

-- ── smoke 测试残渣清库（16 条）────────────────────────────────────────────────
UPDATE journeys SET status = 'deprecated'
WHERE status = 'active'
  AND maturity = 'not_started'
  AND (
    name LIKE '[smoke]%'
    OR name LIKE 'gp-agg-smoke-journey-%'
    OR name = 'Smoke Journey D'
  );
