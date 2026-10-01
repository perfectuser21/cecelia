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

# 只读验证固定白名单；旧docker-prune不能恢复，新增动作仍由显式配置启用。
printf '%s' "$RESP" | node --input-type=module -e '
let body="";
for await (const chunk of process.stdin) body+=chunk;
const {jobs}=JSON.parse(body);
const expected=["preview-owned-npm-cache-expiry-v1"];
if (!Array.isArray(jobs) || JSON.stringify(jobs.map(j=>j.id).sort())!==JSON.stringify(expected)) {
  console.error("[janitor-smoke] FAIL: jobs 与固定白名单不符"); process.exit(1);
}
if (jobs.some(j=>typeof j.enabled!=="boolean" || typeof j.name!=="string")) {
  console.error("[janitor-smoke] FAIL: jobs 状态结构无效"); process.exit(1);
}
'

echo "[janitor-smoke] PASS"
