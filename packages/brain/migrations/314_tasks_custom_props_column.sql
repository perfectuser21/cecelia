-- Migration 314: 为 tasks 表添加 custom_props jsonb 列
--
-- 背景：executor.js 的 markInitiativeTerminalFailed（harness_initiative 任务终态标记，
-- 供 MAX_INITIATIVE_FRESH_STARTS 保护 + 2026-07-05 orchestrator 硬校验共用）执行：
--   UPDATE tasks SET status='failed', error_message=$1,
--     custom_props = jsonb_set(COALESCE(custom_props,'{}'::jsonb), '{failure_class}', $2::jsonb)
--   WHERE id=$3
-- 但 tasks 表此前从未有过 custom_props 列（只有 okr_initiatives 有，migration 300）。
-- 该 UPDATE 语句在真实 Postgres 里会整句报错（column不存在），被函数自身
-- try/catch 静默吞掉（仅 console.warn，non-fatal），导致 status/error_message 也
-- 从未真正写入——这是一个自该保护逻辑引入以来就存在的静默失效 bug，由
-- harness-orchestrator-lockdown-smoke.sh 首次在真实 Postgres 环境下暴露。

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS custom_props jsonb;

COMMENT ON COLUMN tasks.custom_props IS 'harness_initiative 终态失败分类等自由格式元数据，如 {"failure_class": "missing_orchestrator_flag"}';
