#!/usr/bin/env bash
# D Tick Runner Full — real-env smoke
#
# 目标：验证 tick 主循环在生产容器内真跑，且 8 个核心 plugin 都被调用。
#
# 验证点：
#   1. GET /api/brain/tick/status 返回 enabled=true loop_running=true
#   2. 等 ≥1 个完整 tick 周期（默认 130s — interval 2 min 留 margin），
#      验 last_tick / total_executions 推进
#   3. tick-runner.js 静态验：8 plugin 全部被 import（防止某次重构悄悄删 plugin wire）
#   4. docker logs 动态验：≥6/8 plugin 在生产中留过运行痕迹（kr-health-daily 24h
#      gate / pipeline-watchdog 30min gate 可能未触发，所以阈值是 6 不是 8）
#
# 失败：exit 1
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-node-brain}"
WAIT_S="${SMOKE_WAIT_S:-130}"
PLUGIN_RUNTIME_THRESHOLD="${SMOKE_PLUGIN_RUNTIME_MIN:-6}"

echo "=== D Tick Runner Full Smoke ==="
echo "  BRAIN_URL=$BRAIN_URL"
echo "  BRAIN_CONTAINER=$BRAIN_CONTAINER"
echo "  WAIT_S=$WAIT_S"
echo "  PLUGIN_RUNTIME_THRESHOLD=$PLUGIN_RUNTIME_THRESHOLD/8"
echo ""

FAILED=0
pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILED=1; }

command -v jq >/dev/null 2>&1 || { echo "FATAL: jq 未安装"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "FATAL: docker 未安装"; exit 1; }

# 容器健康
docker ps --format '{{.Names}}' | grep -qx "$BRAIN_CONTAINER" || { echo "FATAL: 容器 $BRAIN_CONTAINER 未在跑"; exit 1; }

# 1) tick/status 验初始状态
echo "[1/4] GET /api/brain/tick/status 验 enabled + loop_running"
STATUS_BEFORE="$(curl -sf "$BRAIN_URL/api/brain/tick/status")" || {
  fail "/api/brain/tick/status 不可达"
  exit 1
}
ENABLED="$(echo "$STATUS_BEFORE" | jq -r '.enabled // empty')"
LOOP_RUNNING="$(echo "$STATUS_BEFORE" | jq -r '.loop_running // empty')"
LAST_TICK_BEFORE="$(echo "$STATUS_BEFORE" | jq -r '.last_tick // empty')"

[ "$ENABLED" = "true" ]      && pass "tick.enabled=true"           || fail "tick.enabled=$ENABLED"
[ "$LOOP_RUNNING" = "true" ] && pass "tick.loop_running=true"      || fail "tick.loop_running=$LOOP_RUNNING"
[ -n "$LAST_TICK_BEFORE" ]   && pass "last_tick 字段存在 ($LAST_TICK_BEFORE)" || fail "last_tick 缺失"

HEALTH_BEFORE="$(curl -sf "$BRAIN_URL/api/brain/health" || true)"
EXEC_COUNT_BEFORE="$(echo "$HEALTH_BEFORE" | jq -r '.tick_stats.total_executions // 0')"
echo "  baseline tick_stats.total_executions=$EXEC_COUNT_BEFORE"

# 2) 等 ≥1 完整 tick，验 last_tick / total_executions 推进
echo ""
echo "[2/4] 等 ${WAIT_S}s（覆盖 ≥1 完整 tick 周期），验 lastExecuteTime 推进"
sleep "$WAIT_S"

STATUS_AFTER="$(curl -sf "$BRAIN_URL/api/brain/tick/status")"
HEALTH_AFTER="$(curl -sf "$BRAIN_URL/api/brain/health" || true)"
LAST_TICK_AFTER="$(echo "$STATUS_AFTER" | jq -r '.last_tick // empty')"
EXEC_COUNT_AFTER="$(echo "$HEALTH_AFTER" | jq -r '.tick_stats.total_executions // 0')"

if [ "$LAST_TICK_AFTER" != "$LAST_TICK_BEFORE" ]; then
  pass "last_tick 推进: $LAST_TICK_BEFORE → $LAST_TICK_AFTER"
else
  fail "last_tick 未推进 — 仍 $LAST_TICK_BEFORE，tick loop 可能挂"
fi

if [ "$EXEC_COUNT_AFTER" -gt "$EXEC_COUNT_BEFORE" ]; then
  pass "tick_stats.total_executions: $EXEC_COUNT_BEFORE → $EXEC_COUNT_AFTER"
else
  fail "total_executions 未递增 ($EXEC_COUNT_BEFORE → $EXEC_COUNT_AFTER)"
fi

# 3) 静态验：tick-runner.js 必须 import 8 plugin（容器内）
echo ""
echo "[3/4] 静态验：tick-runner.js import 8 plugin"

declare -a PLUGIN_IMPORTS=(
  'dept-heartbeat'        # ./dept-heartbeat.js
  'kr-progress-sync-plugin'
  'heartbeat-plugin'
  'goal-eval-plugin'
  'pipeline-patrol-plugin'
  'pipeline-watchdog-plugin'
  'kr-health-daily-plugin'
  'cleanup-worker-plugin'
)

# 直接在容器内 grep — 避免 host shell 多层引号转义陷阱
docker exec "$BRAIN_CONTAINER" test -f /app/src/tick-runner.js \
  || { fail "容器内 /app/src/tick-runner.js 不存在"; exit 1; }

IMPORT_HITS=0
for plugin in "${PLUGIN_IMPORTS[@]}"; do
  # docker exec grep 把 pattern 跑在容器里，pattern 不再经 host shell 二次转义
  if docker exec "$BRAIN_CONTAINER" grep -qF "from './${plugin}.js'" /app/src/tick-runner.js; then
    pass "import: $plugin"
    IMPORT_HITS=$((IMPORT_HITS + 1))
  else
    fail "import 缺失: $plugin"
  fi
done

[ "$IMPORT_HITS" -eq 8 ] && pass "8 plugin 全部 wired" || fail "仅 $IMPORT_HITS/8 plugin 被 import"

# 4) 运行时验：docker logs 中 ≥THRESHOLD plugin 留过运行痕迹
echo ""
echo "[4/4] 运行时验：docker logs 中 plugin 执行痕迹（阈值 ≥${PLUGIN_RUNTIME_THRESHOLD}/8）"

# 每行：plugin_name|grep -E pattern（| 是 ERE 的 OR）
declare -a PLUGIN_LOG_PATTERNS=(
  'heartbeat|\[heartbeat\]'
  'dept-heartbeat|\[dept-heartbeat\]|\[tick\] dept heartbeat'
  'kr-progress-sync|\[TICK\] KR 进度同步|kr_verifier_sync|\[tick\] KR verifier'
  'goal-eval|\[goal-evaluator\]|\[tick\] goal-eval'
  'kr-health-daily|KR 可信度|\[tick\] KR health'
  'pipeline-patrol|\[pipeline-patrol\]|Pipeline patrol'
  'pipeline-watchdog|pipeline-watchdog|Pipeline watchdog'
  'cleanup-worker|cleanup-worker|Orphan worktree'
)

# 全量历史 logs（brain 启动后所有，对慢频 plugin 友好）
ALL_LOGS="$(docker logs "$BRAIN_CONTAINER" 2>&1)"
RUNTIME_HITS=0
RUNTIME_MISSES=()
for entry in "${PLUGIN_LOG_PATTERNS[@]}"; do
  name="${entry%%|*}"
  pattern="${entry#*|}"
  if echo "$ALL_LOGS" | grep -qE "$pattern"; then
    pass "runtime: $name"
    RUNTIME_HITS=$((RUNTIME_HITS + 1))
  else
    echo "  SKIP-runtime: $name (无运行时痕迹 — 可能 gate 未触发)"
    RUNTIME_MISSES+=("$name")
  fi
done

echo ""
echo "  Runtime 命中: $RUNTIME_HITS / 8（阈值 $PLUGIN_RUNTIME_THRESHOLD）"
if [ "$RUNTIME_HITS" -lt "$PLUGIN_RUNTIME_THRESHOLD" ]; then
  fail "runtime 命中 < 阈值"
  echo "  未命中: ${RUNTIME_MISSES[*]}"
else
  pass "runtime 命中 ≥ 阈值"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "✅ D Tick Runner Full smoke PASSED"
  exit 0
else
  echo "❌ D Tick Runner Full smoke FAILED"
  exit 1
fi
