#!/usr/bin/env bash
# janitor-smoke.sh — Janitor E2E 验证
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
echo "[janitor-smoke] 开始验证..."

echo "[janitor-smoke] 检查 GET /jobs..."
RESP=$(curl -sf "${BRAIN_URL}/api/brain/janitor/jobs" 2>&1) || {
  echo "[janitor-smoke] FAIL: GET /jobs 无响应"
  exit 1
}
echo "$RESP" | grep -q '"jobs"' || { echo "[janitor-smoke] FAIL: 返回缺少 jobs 字段"; exit 1; }

echo "[janitor-smoke] 触发 docker-prune..."
RUN_RESP=$(curl -sf -X POST "${BRAIN_URL}/api/brain/janitor/jobs/docker-prune/run" 2>&1) || {
  echo "[janitor-smoke] FAIL: POST /run 无响应"
  exit 1
}
echo "$RUN_RESP" | grep -q '"run_id"' || { echo "[janitor-smoke] FAIL: 返回缺少 run_id"; exit 1; }

sleep 3
STATUS=$(curl -sf "${BRAIN_URL}/api/brain/janitor/jobs" | grep -o '"status":"[^"]*"' | head -1)
echo "[janitor-smoke] last_status: $STATUS"
echo "$STATUS" | grep -qE '"success"|"failed"' || { echo "[janitor-smoke] FAIL: 未见执行结果"; exit 1; }

echo "[janitor-smoke] PASS"
