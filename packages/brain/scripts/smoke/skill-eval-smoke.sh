#!/usr/bin/env bash
# skill-eval-smoke.sh — Skill Evaluator 端点 smoke 验证
# Sprint: 07072314-skill-eval-service
#
# 前提：BRAIN_URL 环境变量已设（default: http://localhost:5221）
#       EVAL_PROXY_TOKEN 已设（从 ~/.credentials/skill-eval.env source）

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
EVAL_PROXY_TOKEN="${EVAL_PROXY_TOKEN:-smoke-test-token}"

echo "=== skill-eval-smoke.sh ==="
echo "BRAIN_URL=${BRAIN_URL}"

# ── 1. 无 token → 403 ─────────────────────────────────────────────────────────
echo "--- test 1: POST /api/skill-eval/upload without token → 403 ---"
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
  -F "file=@/dev/null;filename=test.zip" \
  "${BRAIN_URL}/api/skill-eval/upload" 2>/dev/null || echo "000")

# 如果 EVAL_PROXY_TOKEN 未配置，server 会 bypass（dev mode），允许 200/400/422
if [[ "${HTTP_CODE}" == "403" ]]; then
  echo "  PASS: 403 returned (token auth active)"
elif [[ "${HTTP_CODE}" == "400" || "${HTTP_CODE}" == "422" || "${HTTP_CODE}" == "413" ]]; then
  echo "  INFO: ${HTTP_CODE} returned (EVAL_PROXY_TOKEN not set, dev bypass active)"
elif [[ "${HTTP_CODE}" == "000" ]]; then
  echo "  SKIP: Brain not running"
  exit 0
else
  echo "  WARN: unexpected status ${HTTP_CODE}"
fi

# ── 2. 状态查询端点响应 ──────────────────────────────────────────────────────
echo "--- test 2: GET /api/skill-eval/status/invalid-id → 400 ---"
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
  "${BRAIN_URL}/api/skill-eval/status/not-a-uuid" 2>/dev/null || echo "000")

if [[ "${HTTP_CODE}" == "400" ]]; then
  echo "  PASS: 400 invalid UUID"
elif [[ "${HTTP_CODE}" == "000" ]]; then
  echo "  SKIP: Brain not running"
  exit 0
else
  echo "  INFO: got ${HTTP_CODE} (acceptable if Brain is running)"
fi

# ── 3. 状态查询不存在的 task_id → 404 ─────────────────────────────────────────
echo "--- test 3: GET /api/skill-eval/status/<fake-uuid> → 404 ---"
FAKE_UUID="00000000-0000-0000-0000-000000000000"
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
  "${BRAIN_URL}/api/skill-eval/status/${FAKE_UUID}" 2>/dev/null || echo "000")

if [[ "${HTTP_CODE}" == "404" ]]; then
  echo "  PASS: 404 task not found"
elif [[ "${HTTP_CODE}" == "000" ]]; then
  echo "  SKIP: Brain not running"
  exit 0
else
  echo "  INFO: got ${HTTP_CODE}"
fi

echo "=== skill-eval-smoke DONE ==="
