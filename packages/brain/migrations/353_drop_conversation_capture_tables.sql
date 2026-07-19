-- Migration 353: DROP conversation_captures + conversation_log_cursors
-- 决策锚点 decisions a823206d（2026-07-19 Alex 拍板，spec: docs/superpowers/specs/2026-07-19-inbox-unified-capture-design.md P0）
-- conversation-digest 链路 4 个月零成功写入：conversation_captures 全库 0 行（无任何写入方/消费方），
-- conversation_log_cursors 118,294 行全是过期文件路径指针（59,325 pending / 58,969 error），无留存价值。
-- cursors 有 FK 引用 captures，先删 cursors。

DROP TABLE IF EXISTS conversation_log_cursors;
DROP TABLE IF EXISTS conversation_captures;
