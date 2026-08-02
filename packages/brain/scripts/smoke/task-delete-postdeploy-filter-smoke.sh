#!/usr/bin/env bash
# Smoke: task-delete-postdeploy-filter — 137fea96
# 验证 postdeploy-verifier smoke 任务清理机制真正生效：
#   1. Brain /health 健康（前置）
#   2. DELETE /api/brain/tasks/:id 真实存在的非终态任务 → 200 + DB status=cancelled
#   3. DELETE 不存在的任务 → 404 + JSON error/id
#   4. DELETE 已终态（completed）任务 → 409，DB 未被误改
#   5. DELETE 已 cancelled 任务 → 409，DB 仍为 cancelled
#   6. fetchPendingBatch 真调 runPostdeployVerifier() → smoke: 前缀任务被排除
#      （仍 pending_postdeploy），非 smoke 对照任务正常消费为 completed
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# 离散变量 + 显式参数连接约定（与 tasks-ability-id-smoke.sh 一致）
# 不用 DATABASE_URL 拼接字符串传给 psql，避免特殊字符 / 环境传递链路导致的连接失败
PGHOST="${DB_HOST:-localhost}"; PGPORT="${DB_PORT:-5432}"
PGUSER="${DB_USER:-cecelia}"; PGDB="${DB_NAME:-cecelia}"
export PGPASSWORD="${DB_PASSWORD:-cecelia}"

echo "[task-delete-postdeploy-filter-smoke] 1. Brain 健康"
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL}/api/brain/health")
if [[ "$HEALTH_CODE" != "200" ]]; then
  echo "[task-delete-postdeploy-filter-smoke] FAIL: GET /health → ${HEALTH_CODE}（期望 200）"
  exit 1
fi
echo "[task-delete-postdeploy-filter-smoke] Brain 健康 ✓"

echo "[task-delete-postdeploy-filter-smoke] 2. DELETE 存在的非终态任务 → 200 + DB cancelled"
TID=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','smoke: task-delete-ok','{}'::jsonb) RETURNING id" | tr -d ' \n')
SUCCESS_BODY=$(mktemp)
SUCCESS_CODE=$(curl -s -o "$SUCCESS_BODY" -w "%{http_code}" -X DELETE "${BRAIN_URL}/api/brain/tasks/${TID}")
if [[ "$SUCCESS_CODE" != "200" ]]; then
  echo "[task-delete-postdeploy-filter-smoke] FAIL: 存在任务期望 200 得 ${SUCCESS_CODE}"
  rm -f "$SUCCESS_BODY"
  exit 1
fi
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(d.status!=='cancelled'||d.id!==process.argv[2]){console.error('FAIL: 200 响应合同错误: '+JSON.stringify(d));process.exit(1)}" "$SUCCESS_BODY" "$TID"
rm -f "$SUCCESS_BODY"
DBSTATUS=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tAq -c "SELECT status FROM tasks WHERE id='${TID}'" | tr -d ' \n')
if [[ "$DBSTATUS" != "cancelled" ]]; then
  echo "[task-delete-postdeploy-filter-smoke] FAIL: DB status=${DBSTATUS}（期望 cancelled）"
  exit 1
fi
echo "[task-delete-postdeploy-filter-smoke] DELETE 软删除生效，id=${TID} ✓"

echo "[task-delete-postdeploy-filter-smoke] 3. DELETE 不存在的任务 → 404 + JSON error/id"
MISSING_TID='00000000-0000-0000-0000-000000000099'
MISSING_BODY=$(mktemp)
MISSING_CODE=$(curl -s -o "$MISSING_BODY" -w "%{http_code}" -X DELETE "${BRAIN_URL}/api/brain/tasks/${MISSING_TID}")
if [[ "$MISSING_CODE" != "404" ]]; then
  echo "[task-delete-postdeploy-filter-smoke] FAIL: 不存在任务期望 404 得 ${MISSING_CODE}"
  rm -f "$MISSING_BODY"
  exit 1
fi
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(typeof d.error!=='string'||d.id!==process.argv[2]){console.error('FAIL: 404 响应合同错误: '+JSON.stringify(d));process.exit(1)}" "$MISSING_BODY" "$MISSING_TID"
rm -f "$MISSING_BODY"
echo "[task-delete-postdeploy-filter-smoke] 404 JSON 合同生效 ✓"

echo "[task-delete-postdeploy-filter-smoke] 4. DELETE 已 completed 任务 → 409，未被误改"
TID2=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','completed','smoke: task-delete-terminal','{}'::jsonb) RETURNING id" | tr -d ' \n')
COMPLETED_BODY=$(mktemp)
CODE=$(curl -s -o "$COMPLETED_BODY" -w "%{http_code}" -X DELETE "${BRAIN_URL}/api/brain/tasks/${TID2}")
if [[ "$CODE" != "409" ]]; then
  echo "[task-delete-postdeploy-filter-smoke] FAIL: 期望 409 得 ${CODE}"
  rm -f "$COMPLETED_BODY"
  exit 1
fi
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(typeof d.error!=='string'||typeof d.details!=='string'){console.error('FAIL: completed 409 响应合同错误: '+JSON.stringify(d));process.exit(1)}" "$COMPLETED_BODY"
rm -f "$COMPLETED_BODY"
DBSTATUS2=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tAq -c "SELECT status FROM tasks WHERE id='${TID2}'" | tr -d ' \n')
if [[ "$DBSTATUS2" != "completed" ]]; then
  echo "[task-delete-postdeploy-filter-smoke] FAIL: 已终态任务被误改为 ${DBSTATUS2}"
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -c "DELETE FROM tasks WHERE id='${TID2}'" >/dev/null
echo "[task-delete-postdeploy-filter-smoke] 终态保护生效（409，未误改） ✓"

echo "[task-delete-postdeploy-filter-smoke] 5. DELETE 已 cancelled 任务 → 409，未被误改"
CANCELLED_BODY=$(mktemp)
CANCELLED_CODE=$(curl -s -o "$CANCELLED_BODY" -w "%{http_code}" -X DELETE "${BRAIN_URL}/api/brain/tasks/${TID}")
if [[ "$CANCELLED_CODE" != "409" ]]; then
  echo "[task-delete-postdeploy-filter-smoke] FAIL: 已 cancelled 任务期望 409 得 ${CANCELLED_CODE}"
  rm -f "$CANCELLED_BODY"
  exit 1
fi
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(typeof d.error!=='string'||typeof d.details!=='string'){console.error('FAIL: cancelled 409 响应合同错误: '+JSON.stringify(d));process.exit(1)}" "$CANCELLED_BODY"
rm -f "$CANCELLED_BODY"
DBSTATUS3=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tAq -c "SELECT status FROM tasks WHERE id='${TID}'" | tr -d ' \n')
if [[ "$DBSTATUS3" != "cancelled" ]]; then
  echo "[task-delete-postdeploy-filter-smoke] FAIL: 已 cancelled 任务被误改为 ${DBSTATUS3}"
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -c "DELETE FROM tasks WHERE id='${TID}'" >/dev/null
echo "[task-delete-postdeploy-filter-smoke] cancelled 重复删除保护生效 ✓"

echo "[task-delete-postdeploy-filter-smoke] 6. fetchPendingBatch 排除 smoke: 前缀任务（真调 runPostdeployVerifier）"
SMOKE_TID=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','smoke: task-delete-filter-test', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')
CONTROL_TID=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','task-delete-filter-control', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')

PGHOST="$PGHOST" PGPORT="$PGPORT" PGUSER="$PGUSER" PGDATABASE="$PGDB" PGPASSWORD="$PGPASSWORD" \
node --input-type=module -e "
import { runPostdeployVerifier, _resetThrottleForTest } from '$(pwd)/packages/brain/src/postdeploy-verifier.js';
import pg from 'pg';
const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
});
await client.connect();
_resetThrottleForTest();
await runPostdeployVerifier(client);
await client.end();
"

SMOKE_STATUS=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tAq -c "SELECT status FROM tasks WHERE id='${SMOKE_TID}'" | tr -d ' \n')
if [[ "$SMOKE_STATUS" != "pending_postdeploy" ]]; then
  echo "[task-delete-postdeploy-filter-smoke] FAIL: smoke 任务被消费，status=${SMOKE_STATUS}（应保持 pending_postdeploy）"
  exit 1
fi
CONTROL_STATUS=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tAq -c "SELECT status FROM tasks WHERE id='${CONTROL_TID}'" | tr -d ' \n')
if [[ "$CONTROL_STATUS" != "completed" ]]; then
  echo "[task-delete-postdeploy-filter-smoke] FAIL: 对照任务未被消费，status=${CONTROL_STATUS}（应变 completed）"
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -c "DELETE FROM tasks WHERE id IN ('${SMOKE_TID}','${CONTROL_TID}')" >/dev/null
echo "[task-delete-postdeploy-filter-smoke] smoke: 前缀选择性排除生效 ✓"

echo "[task-delete-postdeploy-filter-smoke] ✅ 全部通过"
