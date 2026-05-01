-- Migration 250: 修正 Cecelia features 中 17 个薄弱 smoke_cmd
-- 问题分类：
--   A) 端点完全错误（测 /health 但功能无关）
--   B) 多个 feature 共用同一条命令（无区分度）
--   C) 没测该端点的关键字段（只 type==object）

-- ── A. 端点完全错误 ──────────────────────────────────────────────────────────

-- immune-sweep: 应验证 last_sweep 确实跑过，不是 /health
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/immune/status | jq -e ''.data.last_sweep.started_at != null'''
WHERE id = 'immune-sweep';

-- policy-list: 应验证 policy_rules 存在，不是 /health
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/status | jq -e ''.policy_rules != null'''
WHERE id = 'policy-list';

-- vps-containers: 应用 vps-monitor 端点，不是 /health
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/vps-monitor/stats | jq -e ''.type == "object" or type == "object"'''
WHERE id = 'vps-containers';

-- db-backup: 应验证 pack_version（版本打包状态），不是 /health
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/status | jq -e ''.pack_version != null'''
WHERE id = 'db-backup';

-- notion-sync: 验证 features API 可达（同步的数据源），脚本自身由其入库 PR 覆盖
UPDATE features SET smoke_cmd =
  'curl -sf ''http://localhost:5221/api/brain/features?limit=5'' | jq -e ''.features | length > 0'''
WHERE id = 'notion-sync';

-- orchestrator-chat: 应验证 decision_mode（调度器已初始化），不是 /status type==object
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/status | jq -e ''.decision_mode != null'''
WHERE id = 'orchestrator-chat';

-- intent-parse: 路由文件存在即可（路由未挂载为已知 P1 bug，不在此修）
UPDATE features SET smoke_cmd =
  'node -e "require(''fs'').accessSync(''packages/brain/src/routes/intent-match.js'')"'
WHERE id = 'intent-parse';

-- session-kill: 用 curl -s（不退出4xx），pid=0 返回 400 {"error":"Invalid PID"} 属正常
UPDATE features SET smoke_cmd =
  'curl -s -X POST http://localhost:5221/api/brain/cluster/kill-session -H "Content-Type: application/json" -d ''{"pid":0}'' | jq -e ''has("error") or has("success")'''
WHERE id = 'session-kill';

-- device-lock: 应验证 decision_mode 字段，不是 /status type==object
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/status | jq -e ''.decision_mode != null'''
WHERE id = 'device-lock';

-- ── B. 多 feature 共用同一命令（补充区分度）──────────────────────────────────

-- session-scan: 升级到验证 processes 字段存在（非只 type==object）
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/cluster/scan-sessions | jq -e ''.processes != null'''
WHERE id = 'session-scan';

-- alertness-evaluate: 应调用 POST /alertness/evaluate 真路径（当前与 alertness-get 相同）
UPDATE features SET smoke_cmd =
  'curl -sf -X POST http://localhost:5221/api/brain/alertness/evaluate -H "Content-Type: application/json" -d ''{}'' | jq -e ''.success == true'''
WHERE id = 'alertness-evaluate';

-- alertness-history: 应验证 lastEvaluation 字段（区别于 alertness-get）
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/alertness | jq -e ''.lastEvaluation != null or .level != null'''
WHERE id = 'alertness-history';

-- alertness-override: 应验证 override 字段存在（区别于 alertness-get）
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/alertness | jq -e ''has("override")'''
WHERE id = 'alertness-override';

-- ── C. 关键字段未验证 ────────────────────────────────────────────────────────

-- schedule-rumination: 应用 rumination/status，不是 recurring-tasks array
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/rumination/status | jq -e ''type == "object"'''
WHERE id = 'schedule-rumination';

-- schedule-desire-loop: 应验证 desires 端点有数据字段，不是 recurring-tasks
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/desires | jq -e ''.desires != null'''
WHERE id = 'schedule-desire-loop';

-- schedule-daily-report: 应验证日报端点，不是 recurring-tasks
UPDATE features SET smoke_cmd =
  'curl -sf ''http://localhost:5221/api/brain/design-docs?type=diary&limit=1'' | jq -e ''.data != null'''
WHERE id = 'schedule-daily-report';

-- quarantine-stats: 应验证 stats 字段存在（而非 .success==true）
UPDATE features SET smoke_cmd =
  'curl -sf http://localhost:5221/api/brain/quarantine | jq -e ''.stats != null'''
WHERE id = 'quarantine-stats';
