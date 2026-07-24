#!/usr/bin/env bash
# DoD BEHAVIOR 6 — 对照：不带 smoke: 前缀的同批次任务 → 正常被 runPostdeployVerifier()
# 消费，status 变为 completed（证明过滤是选择性排除，未打坏整个批次消费机制）
set -e
DB="${DB:-postgresql://localhost/cecelia}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CONTROL_TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','dod-b6-filter-control', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')
node --input-type=module -e "
import { runPostdeployVerifier, _resetThrottleForTest } from '${REPO_ROOT}/packages/brain/src/postdeploy-verifier.js';
import pg from 'pg';
const client = new pg.Client(process.env.DB || 'postgresql://localhost/cecelia');
await client.connect();
_resetThrottleForTest();
await runPostdeployVerifier(client);
await client.end();
"
CONTROL_STATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$CONTROL_TID'" | tr -d ' \n')
[ "$CONTROL_STATUS" = "completed" ]
psql "$DB" -c "DELETE FROM tasks WHERE id='$CONTROL_TID'" >/dev/null
echo OK
