#!/usr/bin/env bash
# DoD BEHAVIOR 5 — title 以 "smoke:" 开头的 pending_postdeploy 任务 → 真实调用
# runPostdeployVerifier() 扫描后，status 仍为 pending_postdeploy（未被消费/未标
# completed/failed，payload 无 postdeploy_retry_count 写入）
set -e
DB="${DB:-postgresql://localhost/cecelia}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SMOKE_TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','smoke: dod-b5-filter-test', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')
node --input-type=module -e "
import { runPostdeployVerifier, _resetThrottleForTest } from '${REPO_ROOT}/packages/brain/src/postdeploy-verifier.js';
import pg from 'pg';
const client = new pg.Client(process.env.DB || 'postgresql://localhost/cecelia');
await client.connect();
_resetThrottleForTest();
await runPostdeployVerifier(client);
await client.end();
"
SMOKE_STATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$SMOKE_TID'" | tr -d ' \n')
[ "$SMOKE_STATUS" = "pending_postdeploy" ]
RETRYCOUNT=$(psql "$DB" -tAq -c "SELECT payload->>'postdeploy_retry_count' FROM tasks WHERE id='$SMOKE_TID'" | tr -d ' \n')
[ -z "$RETRYCOUNT" ]
psql "$DB" -c "DELETE FROM tasks WHERE id='$SMOKE_TID'" >/dev/null
echo OK
