#!/usr/bin/env bash
# E1 Observer Runner Flow — real-env smoke
#
# 目标：验证 Observer Runner 在真生产环境（cecelia-node-brain 容器 + 真 PG）
#      作为 setInterval 后台任务持续运行，state/health 端点暴露完整快照。
#
# 验证点：
#   1. GET /api/brain/observer/state 返回 200 + 含 alertness/health/resources/last_run_at/run_count
#   2. sleep 35s 后 run_count 严格递增（证明 setInterval 在跑，不是 stale snapshot）
#   3. GET /api/brain/observer/health 返回 healthy=true
#
# 依赖：Brain 在 BRAIN_URL（默认 localhost:5221）真实跑，jq 已安装
# 失败：exit 1，CI 能识别
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SLEEP_S="${SMOKE_SLEEP_S:-35}"

echo "=== E1 Observer Runner Flow Smoke ==="
echo "  BRAIN_URL=$BRAIN_URL"
echo "  SLEEP_S=$SLEEP_S"
echo ""

FAILED=0
pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILED=1; }

# 依赖检查
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq 未安装"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "FATAL: curl 未安装"; exit 1; }

# 1) GET /api/brain/observer/state — 返回 200 + 必需字段齐全
echo "[1/3] GET /api/brain/observer/state 验关键字段"
STATE_BODY="$(curl -sf -w '\nHTTP_STATUS:%{http_code}\n' "$BRAIN_URL/api/brain/observer/state" 2>&1)" || {
  fail "/api/brain/observer/state 不可达"
  echo "$STATE_BODY"
  exit 1
}
HTTP_CODE="$(echo "$STATE_BODY" | grep '^HTTP_STATUS:' | cut -d: -f2)"
JSON_BODY="$(echo "$STATE_BODY" | sed '/^HTTP_STATUS:/d')"

if [ "$HTTP_CODE" = "200" ]; then
  pass "HTTP 200"
else
  fail "HTTP $HTTP_CODE (期望 200)"
fi

INITIAL_RUN_COUNT="$(echo "$JSON_BODY" | jq -r '.run_count // empty')"
LAST_RUN_AT="$(echo "$JSON_BODY" | jq -r '.last_run_at // empty')"
ALERTNESS_LEVEL="$(echo "$JSON_BODY" | jq -r '.alertness.level // empty')"
HEALTH_LEVEL="$(echo "$JSON_BODY" | jq -r '.health.level // empty')"
RESOURCES_OK="$(echo "$JSON_BODY" | jq -r '.resources.ok // empty')"

[ -n "$INITIAL_RUN_COUNT" ]   && pass "run_count 字段存在 (=$INITIAL_RUN_COUNT)"   || fail "run_count 缺失"
[ -n "$LAST_RUN_AT" ]         && pass "last_run_at 字段存在 ($LAST_RUN_AT)"        || fail "last_run_at 缺失"
[ -n "$ALERTNESS_LEVEL" ]     && pass "alertness.level 字段存在 (=$ALERTNESS_LEVEL)" || fail "alertness 缺失"
[ -n "$HEALTH_LEVEL" ]        && pass "health.level 字段存在 (=$HEALTH_LEVEL)"     || fail "health 缺失"
[ -n "$RESOURCES_OK" ]        && pass "resources.ok 字段存在 (=$RESOURCES_OK)"     || fail "resources 缺失"

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "Initial state payload (前 1000 字符):"
  echo "$JSON_BODY" | head -c 1000
  echo ""
  exit 1
fi

# 2) sleep + 验 run_count 递增
echo ""
echo "[2/3] Sleep ${SLEEP_S}s, 验 run_count 递增（证明 setInterval 在跑）"
sleep "$SLEEP_S"

LATER_BODY="$(curl -sf "$BRAIN_URL/api/brain/observer/state")" || {
  fail "第二次 curl observer/state 失败"
  exit 1
}
LATER_RUN_COUNT="$(echo "$LATER_BODY" | jq -r '.run_count // empty')"
LATER_LAST_RUN_AT="$(echo "$LATER_BODY" | jq -r '.last_run_at // empty')"

if [ -z "$LATER_RUN_COUNT" ]; then
  fail "第二次取 run_count 失败"
elif [ "$LATER_RUN_COUNT" -gt "$INITIAL_RUN_COUNT" ]; then
  pass "run_count: $INITIAL_RUN_COUNT → $LATER_RUN_COUNT (Δ=$((LATER_RUN_COUNT - INITIAL_RUN_COUNT)))"
else
  fail "run_count 未递增 ($INITIAL_RUN_COUNT → $LATER_RUN_COUNT) — Observer setInterval 可能挂了"
fi

if [ "$LATER_LAST_RUN_AT" != "$LAST_RUN_AT" ]; then
  pass "last_run_at 已推进: $LAST_RUN_AT → $LATER_LAST_RUN_AT"
else
  fail "last_run_at 未推进 — 仍是 $LAST_RUN_AT"
fi

# 3) GET /api/brain/observer/health → healthy=true
echo ""
echo "[3/3] GET /api/brain/observer/health 验 healthy=true"
HEALTH_BODY="$(curl -sf "$BRAIN_URL/api/brain/observer/health")" || {
  fail "/api/brain/observer/health 不可达"
  exit 1
}
HEALTHY="$(echo "$HEALTH_BODY" | jq -r '.healthy // empty')"
LAST_RUN_AGE_MS="$(echo "$HEALTH_BODY" | jq -r '.last_run_age_ms // empty')"

if [ "$HEALTHY" = "true" ]; then
  pass "observer healthy=true (last_run_age_ms=$LAST_RUN_AGE_MS)"
else
  fail "observer healthy=$HEALTHY (期望 true), age=$LAST_RUN_AGE_MS ms"
  echo "$HEALTH_BODY"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "✅ E1 Observer Runner Flow smoke PASSED"
  exit 0
else
  echo "❌ E1 Observer Runner Flow smoke FAILED"
  exit 1
fi
