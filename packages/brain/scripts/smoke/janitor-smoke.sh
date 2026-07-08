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

# docker-prune 已取消——部署自杀竞态 Issue 97cf5a41，2026-07-08。
# REGISTRY 现为空，jobs 应为空数组，不再触发 docker-prune run。
echo "$RESP" | grep -q 'docker-prune' && { echo "[janitor-smoke] FAIL: docker-prune 应已取消，不应出现在 jobs 列表"; exit 1; }
echo "$RESP" | grep -q '"jobs":\[\]' || { echo "[janitor-smoke] FAIL: jobs 应为空数组（REGISTRY 已清空）"; exit 1; }

echo "[janitor-smoke] PASS"
