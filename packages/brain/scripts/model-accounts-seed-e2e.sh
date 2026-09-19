#!/usr/bin/env bash
# model-accounts-seed-e2e.sh — 幂等 seed 8 行 e2e- 前缀模型账号快照（工厂·F5 指挥舱 刀2）
#
# 为什么单独一个 seed 脚本：ops_model_accounts 的采集腿（host-exec ssh 到 mmv 读真凭据）
# 不进 CI，故端点在 CI 里只有被显式 seed 的行。合同 Golden Path / DoD B-01~B-03 明确以
# "E2E 段预置 e2e- 前缀 8 行" 为前置条件（见 contract-draft.md ## E2E 验收）。本脚本把该
# 前置条件物化为可复用的一步，供 DoD BEHAVIOR 命令与 real-env smoke 共同调用——断言口径
# （jq oracle）保持与合同逐字一致，只补齐合同已声明的 seed 前置。
#
# 连接：优先 DATABASE_URL / DB_URL / DB（dod-behavior-dynamic 三者均注入；real-env-smoke /
# smoke-ratchet 注入 DATABASE_URL），空串时 psql 回落 PG* 环境变量。
set -euo pipefail

CONN="${DATABASE_URL:-${DB_URL:-${DB:-}}}"

psql "$CONN" -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM ops_model_accounts WHERE account_id LIKE 'e2e-%';
INSERT INTO ops_model_accounts (account_id, provider, plan, five_hour_pct, seven_day_pct, reset_at, host_alias, forwardable, forward_targets, status, last_error, last_checked_at, updated_at)
VALUES
 ('e2e-claude1','claude','max',10,20,NOW(),'mmv',FALSE,'[]','ok',NULL,NOW(),NOW()),
 ('e2e-claude2','claude','max',15,25,NOW(),'mmv',FALSE,'[]','ok',NULL,NOW(),NOW()),
 ('e2e-codex1','codex','team',30,40,NOW(),'mmv',TRUE,'["xian-m4","xian-m1"]','ok',NULL,NOW(),NOW()),
 ('e2e-codex2','codex','team',35,45,NOW(),'mmv',TRUE,'["xian-m4","xian-m1"]','ok',NULL,NOW(),NOW()),
 ('e2e-codex3','codex','team',12,22,NOW(),'mmv',TRUE,'["xian-m4","xian-m1"]','ok',NULL,NOW(),NOW()),
 ('e2e-codex4','codex','team',18,28,NOW(),'mmv',TRUE,'["xian-m4","xian-m1"]','unknown','token timeout',NOW(),NOW()),
 ('e2e-codex5','codex','team',NULL,NULL,NULL,'mmv',TRUE,'["xian-m4","xian-m1"]','no_credential','auth.json missing',NOW(),NOW()),
 ('e2e-grok','grok',NULL,NULL,NULL,NULL,'mmv',FALSE,'[]','key_expired','grpc-status 7 PERMISSION_DENIED',NOW(),NOW())
ON CONFLICT (account_id) DO UPDATE SET
  provider=EXCLUDED.provider, plan=EXCLUDED.plan,
  five_hour_pct=EXCLUDED.five_hour_pct, seven_day_pct=EXCLUDED.seven_day_pct,
  reset_at=EXCLUDED.reset_at, host_alias=EXCLUDED.host_alias,
  forwardable=EXCLUDED.forwardable, forward_targets=EXCLUDED.forward_targets,
  status=EXCLUDED.status, last_error=EXCLUDED.last_error,
  last_checked_at=NOW(), updated_at=NOW();
SQL
