-- KR Verification 闭环：自动采集 KR 指标，防止进度虚报
-- 每个 KR 绑定一个 SQL 查询，定时运行采集 metric_current
-- progress 只由公式计算，任何 agent 都不能直接写 progress

CREATE TABLE IF NOT EXISTS kr_verifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  verifier_type VARCHAR(20) NOT NULL DEFAULT 'sql',  -- sql | api | manual
  query TEXT NOT NULL,                                 -- SQL 查询语句
  metric_field VARCHAR(100) DEFAULT 'count',           -- 查询结果中取哪个字段
  threshold NUMERIC NOT NULL,                          -- 目标值（= metric_to）
  operator VARCHAR(5) NOT NULL DEFAULT '>=',           -- >= | <= | == | >
  current_value NUMERIC DEFAULT 0,                     -- 上次查询的值
  last_checked TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  check_interval_minutes INTEGER DEFAULT 60,           -- 检查频率（分钟）
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kr_verifiers_kr_id ON kr_verifiers(kr_id);
CREATE INDEX IF NOT EXISTS idx_kr_verifiers_enabled ON kr_verifiers(enabled) WHERE enabled = true;

-- Seed：为现有 10 个活跃 KR 创建 verifier
-- 发布≥500条
INSERT INTO kr_verifiers (kr_id, query, threshold, operator)
SELECT id,
  'SELECT COUNT(*)::numeric as count FROM publish_results WHERE created_at > NOW() - INTERVAL ''30 days''',
  500, '>='
FROM goals WHERE type='area_okr' AND status='in_progress' AND title LIKE '%发布%500%'
ON CONFLICT DO NOTHING;

-- 每天汇报≥3次（30天=90次）
INSERT INTO kr_verifiers (kr_id, query, threshold, operator)
SELECT id,
  'SELECT COUNT(*)::numeric as count FROM daily_logs WHERE created_at > NOW() - INTERVAL ''30 days''',
  90, '>='
FROM goals WHERE type='area_okr' AND status='in_progress' AND title LIKE '%汇报%3次%'
ON CONFLICT DO NOTHING;

-- 自修≥200次
INSERT INTO kr_verifiers (kr_id, query, threshold, operator)
SELECT id,
  'SELECT COUNT(*)::numeric as count FROM self_healing_log WHERE created_at > NOW() - INTERVAL ''30 days''',
  200, '>='
FROM goals WHERE type='area_okr' AND status='in_progress' AND title LIKE '%自修%200%'
ON CONFLICT DO NOTHING;

-- 跨设备任务完成率
INSERT INTO kr_verifiers (kr_id, query, threshold, operator)
SELECT id,
  'SELECT COUNT(DISTINCT location)::numeric as count FROM tasks WHERE status=''completed'' AND completed_at > NOW() - INTERVAL ''30 days''',
  3, '>='
FROM goals WHERE type='area_okr' AND status='in_progress' AND title LIKE '%跨5设备%'
ON CONFLICT DO NOTHING;

-- Dashboard 操作≥100次
INSERT INTO kr_verifiers (kr_id, query, threshold, operator)
SELECT id,
  'SELECT COUNT(*)::numeric as count FROM page_views WHERE created_at > NOW() - INTERVAL ''30 days''',
  100, '>='
FROM goals WHERE type='area_okr' AND status='in_progress' AND title LIKE '%dashboard%100%'
ON CONFLICT DO NOTHING;

-- 数据采集+周报≥12份
INSERT INTO kr_verifiers (kr_id, query, threshold, operator)
SELECT id,
  'SELECT COUNT(*)::numeric as count FROM analytics_aggregations WHERE created_at > NOW() - INTERVAL ''30 days''',
  12, '>='
FROM goals WHERE type='area_okr' AND status='in_progress' AND title LIKE '%周报%月报%'
ON CONFLICT DO NOTHING;

-- self-model 更新≥90天
INSERT INTO kr_verifiers (kr_id, query, threshold, operator)
SELECT id,
  'SELECT COUNT(DISTINCT DATE(created_at))::numeric as count FROM self_reports WHERE created_at > NOW() - INTERVAL ''90 days''',
  90, '>='
FROM goals WHERE type='area_okr' AND status='in_progress' AND title LIKE '%self-model%90天%'
ON CONFLICT DO NOTHING;

-- 内容生成自动化
INSERT INTO kr_verifiers (kr_id, query, threshold, operator)
SELECT id,
  'SELECT COUNT(*)::numeric as count FROM content_topics WHERE created_at > NOW() - INTERVAL ''30 days''',
  30, '>='
FROM goals WHERE type='area_okr' AND status='in_progress' AND title LIKE '%内容生成%100%'
ON CONFLICT DO NOTHING;
