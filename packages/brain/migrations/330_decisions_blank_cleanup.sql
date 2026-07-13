-- packages/brain/migrations/330_decisions_blank_cleanup.sql
-- T8 一次性清理：decisions 表历史空白垃圾行（topic/decision 均空的遥测记录）
-- 取证（2026-07-10）：96,322 行 = tick 93,702（2026-05-04 后已停写）+ consciousness_loop 2,618
--（灌水源，已在 decision.js 加写入去重）+ NULL trigger 2。
-- trigger 白名单收紧：只删审计确认的三类来源，防止误删其他来源的空 topic 行。
-- 安全审计（addendum-01）：topic IS NULL 的行未被任何查询用 topic 做筛选条件。
DELETE FROM decisions
WHERE (topic IS NULL OR topic = '')
  AND (decision IS NULL OR decision = '')
  AND (trigger IN ('tick', 'consciousness_loop') OR trigger IS NULL);
