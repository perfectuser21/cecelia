#!/usr/bin/env bash
# model-accounts-seed-e2e.sh — seed 8 行 e2e- 前缀模型账号投影 fixture。
# 由 model-accounts-smoke.sh 在已核对身份的测试环境调用，不探测凭据或真实机器。
# 保留 Claude/Codex/Grok 历史数据格式与失败状态的投影覆盖。
# 连接优先 DATABASE_URL / DB_URL / DB；未设置时使用 psql 的 PG* 环境变量。
# fixture-worker 仅用于验证转发目标字段的原样投影，不代表现役机器布局或可达性。
set -euo pipefail

CONN="${DATABASE_URL:-${DB_URL:-${DB:-}}}"

psql -X "$CONN" -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM ops_model_accounts WHERE account_id LIKE 'e2e-%';
INSERT INTO ops_model_accounts (account_id, provider, plan, five_hour_pct, seven_day_pct, reset_at, host_alias, forwardable, forward_targets, status, last_error, last_checked_at, updated_at)
VALUES
 ('e2e-claude1','claude','max',10,20,NOW(),'mmv',FALSE,'[]','ok',NULL,NOW(),NOW()),
 ('e2e-claude2','claude','max',15,25,NOW(),'mmv',FALSE,'[]','ok',NULL,NOW(),NOW()),
 ('e2e-codex1','codex','team',30,40,NOW(),'mmv',TRUE,'["fixture-worker"]','ok',NULL,NOW(),NOW()),
 ('e2e-codex2','codex','team',35,45,NOW(),'mmv',TRUE,'["fixture-worker"]','ok',NULL,NOW(),NOW()),
 ('e2e-codex3','codex','team',12,22,NOW(),'mmv',TRUE,'["fixture-worker"]','ok',NULL,NOW(),NOW()),
 ('e2e-codex4','codex','team',18,28,NOW(),'mmv',TRUE,'["fixture-worker"]','unknown','token timeout',NOW(),NOW()),
 ('e2e-codex5','codex','team',NULL,NULL,NULL,'mmv',TRUE,'["fixture-worker"]','no_credential','auth.json missing',NOW(),NOW()),
 ('e2e-grok','grok',NULL,NULL,NULL,NULL,'mmv',FALSE,'[]','key_expired','grpc-status 7 PERMISSION_DENIED',NOW(),NOW())
ON CONFLICT (account_id) DO UPDATE SET
  provider=EXCLUDED.provider, plan=EXCLUDED.plan,
  five_hour_pct=EXCLUDED.five_hour_pct, seven_day_pct=EXCLUDED.seven_day_pct,
  reset_at=EXCLUDED.reset_at, host_alias=EXCLUDED.host_alias,
  forwardable=EXCLUDED.forwardable, forward_targets=EXCLUDED.forward_targets,
  status=EXCLUDED.status, last_error=EXCLUDED.last_error,
  last_checked_at=NOW(), updated_at=NOW();
SQL
