#!/usr/bin/env bash
# auto-staging-smoke.sh — main push 自动部署后，验证常驻 staging Brain(5222) 真健康。
#
# 与 staging-verify.sh 的关系：
#   staging-verify.sh 在部署机本地（localhost:5222）跑，做 4 项深度检查。
#   本脚本面向 auto-staging-deploy.yml workflow（云端 runner 经 Tailscale 远程
#   访问 staging），只做"部署是否真起来 + smoke 是否真跑通"的硬验证，可被
#   STAGING_HOST/STAGING_PORT 参数化（便于 CI 指向 Tailscale 内网地址、
#   也便于 negative 测试指向必失败端口）。
#
# 退出码：
#   0 = STAGING_SMOKE_OK（staging 部署起来且 smoke 通过）
#   1 = STAGING_SMOKE_FAIL（staging 没起 / smoke 没过）—— workflow 红
#
# 注意：本脚本只验证 staging(5222)，绝不触碰 production(5221)，绝不 promote。
set -uo pipefail

STAGING_HOST="${STAGING_HOST:-localhost}"
STAGING_PORT="${STAGING_PORT:-5222}"
STAGING_URL="http://${STAGING_HOST}:${STAGING_PORT}"
FAILED=0

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1"; FAILED=$((FAILED + 1)); }

printf '%s\n' "=== auto-staging-smoke (target ${STAGING_URL}) ==="

# ── 1. staging 健康端点（部署真起来了）────────────────────────────────────────
HTTP_CODE=$(curl -s -o /tmp/auto_staging_health.txt -w "%{http_code}" \
  "${STAGING_URL}/api/brain/health" \
  --connect-timeout 10 --max-time 20 2>/dev/null)
HTTP_CODE="${HTTP_CODE:-000}"

if [ "$HTTP_CODE" -ge 200 ] 2>/dev/null && [ "$HTTP_CODE" -lt 300 ] 2>/dev/null; then
  pass "/api/brain/health → HTTP ${HTTP_CODE}（staging 已起）"
else
  fail "/api/brain/health → HTTP ${HTTP_CODE}（staging 未起或不可达）"
fi

# ── 2. tick 状态端点可访问 + staging tick 必须禁用（不抢 production 任务）────
TICK_JSON=$(curl -s "${STAGING_URL}/api/brain/tick/status" \
  --connect-timeout 10 --max-time 20 2>/dev/null || echo "{}")

TICK_ENABLED=$(printf '%s' "$TICK_JSON" | node -e "
  try { const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
        console.log(d.hasOwnProperty('enabled') ? String(d.enabled) : 'missing'); }
  catch (e) { console.log('error'); }
" 2>/dev/null || echo "error")

if [ "$TICK_ENABLED" = "false" ]; then
  pass "/api/brain/tick/status 可访问且 tick 已禁用（staging 不抢任务）"
elif [ "$TICK_ENABLED" = "true" ]; then
  fail "staging tick 未禁用（enabled=true，会抢 production 任务）"
else
  fail "/api/brain/tick/status 不可访问或缺 enabled 字段（${TICK_ENABLED}）"
fi

# ── 3. DB 连接（经 tasks 端点间接验证 staging DB 可读）────────────────────────
TASKS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "${STAGING_URL}/api/brain/tasks?limit=1" \
  --connect-timeout 10 --max-time 20 2>/dev/null)
TASKS_CODE="${TASKS_CODE:-000}"

if [ "$TASKS_CODE" -ge 200 ] 2>/dev/null && [ "$TASKS_CODE" -lt 300 ] 2>/dev/null; then
  pass "/api/brain/tasks → HTTP ${TASKS_CODE}（staging DB 连接正常）"
else
  fail "/api/brain/tasks → HTTP ${TASKS_CODE}（staging DB 连接可能失败）"
fi

printf '%s\n' "----------------------------------------"
if [ "$FAILED" -eq 0 ]; then
  printf '%s\n' "✅ STAGING_SMOKE_OK — staging 部署起来且 smoke 通过"
  exit 0
else
  printf '%s\n' "❌ STAGING_SMOKE_FAIL — ${FAILED} 项失败"
  echo "  staging 日志: docker logs cecelia-node-brain-staging --tail 50"
  exit 1
fi
