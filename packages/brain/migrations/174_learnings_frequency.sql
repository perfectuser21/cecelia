-- Migration 174: learnings 频率强化 — 添加 last_reinforced_at，初始化 frequency_count，清理历史重复
-- 对应功能：upsertLearning() 去重写入 + frequency_count 递增

-- 1. 添加 last_reinforced_at 字段
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS last_reinforced_at TIMESTAMPTZ;

-- 2. 初始化 frequency_count = 1 for all NULL rows
UPDATE learnings
  SET frequency_count = 1
  WHERE frequency_count IS NULL;

-- 3. 去重历史数据：按 title 合并，保留 created_at 最早的行，累加 frequency_count
-- 用 CTE 统一确定 keep_id（两步操作共用同一排序规则）
WITH duplicates AS (
  SELECT
    title,
    MIN(created_at) AS oldest_at,
    COUNT(*) AS total_count,
    MAX(created_at) AS latest_at
  FROM learnings
  GROUP BY title
  HAVING COUNT(*) > 1
),
keep_ids AS (
  SELECT DISTINCT ON (l.title)
    l.id AS keep_id,
    d.total_count,
    d.latest_at
  FROM learnings l
  JOIN duplicates d ON l.title = d.title
  ORDER BY l.title, l.created_at ASC  -- 保留最早创建的那一行
)
-- 步骤 A：更新要保留的行的频次
UPDATE learnings l
SET frequency_count = k.total_count,
    last_reinforced_at = k.latest_at
FROM keep_ids k
WHERE l.id = k.keep_id;

-- 步骤 B：删除同 title 的多余行（keep_id 以外的所有重复行）
DELETE FROM learnings
WHERE id IN (
  SELECT l.id
  FROM learnings l
  JOIN (
    SELECT DISTINCT ON (title)
      id AS keep_id,
      title
    FROM learnings
    ORDER BY title, created_at ASC
  ) kept ON l.title = kept.title AND l.id <> kept.keep_id
);
