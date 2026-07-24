#!/bin/bash
set -e
DB="${DB:-postgresql://localhost/cecelia}"

echo "── 1. DELETE 存在的 pending_postdeploy 任务 → 200 + DB cancelled ──"
TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','final-e2e-delete-ok','{}'::jsonb) RETURNING id" | tr -d ' \n')
RESP=$(curl -sf -X DELETE "localhost:5221/api/brain/tasks/$TID")
echo "$RESP" | jq -e '.status == "cancelled"' || { echo "FAIL: 响应 status 非 cancelled"; exit 1; }
DBSTATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID'" | tr -d ' \n')
[ "$DBSTATUS" = "cancelled" ] || { echo "FAIL: DB status=$DBSTATUS"; exit 1; }
echo "✅ Step1 通过"

echo "── 2. DELETE 不存在的 id → 404 ──"
CODE=$(curl -s -o /tmp/e2e_404.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000099")
[ "$CODE" = "404" ] || { echo "FAIL: 期望404得$CODE"; exit 1; }
jq -e '.error | type == "string"' /tmp/e2e_404.json || { echo "FAIL: 缺error字段"; exit 1; }
jq -e '.id == "00000000-0000-0000-0000-000000000099"' /tmp/e2e_404.json || { echo "FAIL: 404响应id字段未回显请求id"; exit 1; }
echo "✅ Step2 通过"

echo "── 3. DELETE 已 completed 任务 → 409，未被误改 ──"
TID2=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','completed','final-e2e-delete-terminal','{}'::jsonb) RETURNING id" | tr -d ' \n')
CODE2=$(curl -s -o /tmp/e2e_409_completed.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/$TID2")
[ "$CODE2" = "409" ] || { echo "FAIL: 期望409得$CODE2"; exit 1; }
jq -e '.error | type == "string"' /tmp/e2e_409_completed.json || { echo "FAIL: 409响应缺error字段"; exit 1; }
jq -e '.details | type == "string"' /tmp/e2e_409_completed.json || { echo "FAIL: 409响应缺details字段"; exit 1; }
DBSTATUS2=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID2'" | tr -d ' \n')
[ "$DBSTATUS2" = "completed" ] || { echo "FAIL: 已终态任务被误改为$DBSTATUS2"; exit 1; }
psql "$DB" -c "DELETE FROM tasks WHERE id='$TID2'" >/dev/null
echo "✅ Step3 通过"

echo "── 4. DELETE 已 cancelled 任务再次 DELETE → 409，幂等未被误改 ──"
TID2B=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','cancelled','final-e2e-delete-already-cancelled','{}'::jsonb) RETURNING id" | tr -d ' \n')
CODE2B=$(curl -s -o /tmp/e2e_409_cancelled.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/$TID2B")
[ "$CODE2B" = "409" ] || { echo "FAIL: 期望409得$CODE2B"; exit 1; }
jq -e '.error | type == "string"' /tmp/e2e_409_cancelled.json || { echo "FAIL: 409响应缺error字段"; exit 1; }
jq -e '.details | type == "string"' /tmp/e2e_409_cancelled.json || { echo "FAIL: 409响应缺details字段"; exit 1; }
DBSTATUS2B=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID2B'" | tr -d ' \n')
[ "$DBSTATUS2B" = "cancelled" ] || { echo "FAIL: 已cancelled任务被误改为$DBSTATUS2B"; exit 1; }
psql "$DB" -c "DELETE FROM tasks WHERE id='$TID2B'" >/dev/null
echo "✅ Step4 通过"

echo "── 5. fetchPendingBatch 排除 smoke: 前缀任务（纵深防御，选择性排除）──"
SMOKE_TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','smoke: final-e2e-filter-test', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')
CONTROL_TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','final-e2e-filter-control', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')

node --input-type=module -e "
import { runPostdeployVerifier, _resetThrottleForTest } from '$(pwd)/packages/brain/src/postdeploy-verifier.js';
import pg from 'pg';
const client = new pg.Client(process.env.DB || 'postgresql://localhost/cecelia');
await client.connect();
_resetThrottleForTest();
await runPostdeployVerifier(client);
await client.end();
"

SMOKE_STATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$SMOKE_TID'" | tr -d ' \n')
[ "$SMOKE_STATUS" = "pending_postdeploy" ] || { echo "FAIL: smoke任务被消费status=$SMOKE_STATUS"; exit 1; }
CONTROL_STATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$CONTROL_TID'" | tr -d ' \n')
[ "$CONTROL_STATUS" = "completed" ] || { echo "FAIL: 对照任务未被消费status=$CONTROL_STATUS"; exit 1; }
psql "$DB" -c "DELETE FROM tasks WHERE id IN ('$SMOKE_TID','$CONTROL_TID')" >/dev/null
echo "✅ Step5 通过"

echo "── 6. postdeploy-verifier-smoke.sh 全脚本回归（真实清理链路）──"
OUT=$(BRAIN_URL=http://localhost:5221 bash packages/brain/scripts/smoke/postdeploy-verifier-smoke.sh 2>&1)
echo "$OUT"
TID3=$(echo "$OUT" | grep -oE 'id=[0-9a-f-]{36}' | head -1 | cut -d= -f2)
[ -n "$TID3" ] || { echo "FAIL: 未解析出smoke脚本task id"; exit 1; }
DBSTATUS3=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID3'" | tr -d ' \n')
[ "$DBSTATUS3" = "cancelled" ] || { echo "FAIL: smoke脚本清理后status=$DBSTATUS3"; exit 1; }
echo "✅ Step6 通过"

echo "✅ Golden Path 全链路验证通过"
