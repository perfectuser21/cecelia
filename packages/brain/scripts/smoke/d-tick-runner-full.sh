#!/usr/bin/env bash
# D Tick Runner Full — real-env smoke
#
# 目标：验证 tick 主循环在生产容器内真跑，且 8 个核心 plugin 都被 wired + 调用。
#
# 设计契约（CI 友好 + 生产同样适用）：
#   1. /api/brain/tick/status 可达 + enabled 字段存在
#   2. POST /api/brain/tick 主动触发一次 manual tick — 不依赖 TICK_ENABLED
#      （CI real-env-smoke 把 CECELIA_TICK_ENABLED=false，loop 不会自启）
#   3. 验 last_tick 推进 + tick_stats.total_executions++
#      —— 强契约：tick 端到端跑过 = executeTick() 走完整 plugin 序列
#   4. 静态验 tick-runner.js 必须 import 8 个核心 plugin（防重构悄悄删 wire）
#   5. 软验：docker logs 至少 1 条 plugin 痕迹（CI 空 DB 多数 plugin silent on no-op
#      所以阈值仅 1，仅作 diagnostic）
#
# 容器名自动适配：
#   - BRAIN_CONTAINER env 优先（覆盖一切）
#   - fallback 1: cecelia-brain-smoke（CI real-env-smoke job）
#   - fallback 2: cecelia-node-brain（生产 / docker compose）
#
# 失败：exit 1
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PLUGIN_RUNTIME_THRESHOLD="${SMOKE_PLUGIN_RUNTIME_MIN:-1}"
TICK_SETTLE_S="${SMOKE_TICK_SETTLE_S:-3}"

# 容器名自动检测
detect_container() {
  if [ -n "${BRAIN_CONTAINER:-}" ]; then
    echo "$BRAIN_CONTAINER"
    return
  fi
  for c in cecelia-brain-smoke cecelia-node-brain; do
    if docker ps --format '{{.Names}}' | grep -qx "$c"; then
      echo "$c"
      return
    fi
  done
  echo ""
}

BRAIN_CONTAINER="$(detect_container)"

echo "=== D Tick Runner Full Smoke ==="
echo "  BRAIN_URL=$BRAIN_URL"
echo "  BRAIN_CONTAINER=${BRAIN_CONTAINER:-<not detected>}"
echo "  TICK_SETTLE_S=$TICK_SETTLE_S"
echo "  PLUGIN_RUNTIME_THRESHOLD=$PLUGIN_RUNTIME_THRESHOLD/8"
echo ""

FAILED=0
pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILED=1; }

command -v jq >/dev/null 2>&1 || { echo "FATAL: jq 未安装"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "FATAL: docker 未安装"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "FATAL: curl 未安装"; exit 1; }

[ -n "$BRAIN_CONTAINER" ] || { echo "FATAL: 未检测到 brain 容器（试过 cecelia-brain-smoke / cecelia-node-brain；可用 BRAIN_CONTAINER env 显式指定）"; exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$BRAIN_CONTAINER" \
  || { echo "FATAL: 容器 $BRAIN_CONTAINER 未在跑"; exit 1; }

# 1) tick/status 验初始可达 + 字段存在
echo "[1/5] GET /api/brain/tick/status 验可达 + enabled 字段"
STATUS_BEFORE="$(curl -sf "$BRAIN_URL/api/brain/tick/status")" || {
  echo "FATAL: /api/brain/tick/status 不可达"
  exit 1
}
ENABLED="$(echo "$STATUS_BEFORE" | jq -r '.enabled // empty')"
LAST_TICK_BEFORE="$(echo "$STATUS_BEFORE" | jq -r '.last_tick // empty')"
EXEC_COUNT_BEFORE="$(echo "$STATUS_BEFORE" | jq -r '.tick_stats.total_executions // 0')"

# enabled 字段必须存在（true 或 false 都算通过；CI 设 false，生产为 true）
if [ -n "$ENABLED" ]; then
  pass "tick.enabled 字段存在 ($ENABLED)"
else
  fail "tick.enabled 字段缺失"
fi
echo "  baseline: last_tick=${LAST_TICK_BEFORE:-<null>} total_executions=$EXEC_COUNT_BEFORE"

# 2) 主动触发 manual tick（不依赖 TICK_ENABLED / loop_running）
echo ""
echo "[2/5] POST /api/brain/tick — 触发 manual tick"
TICK_RESP="$(curl -sf -X POST "$BRAIN_URL/api/brain/tick" -H 'Content-Type: application/json' -d '{}')" || {
  fail "POST /api/brain/tick 失败"
  TICK_RESP="{}"
}
# 可能三种成功路径：
#   a) result.success === true  （executeTick 正常跑完，Wave 1 格式）
#   b) result.skipped === true  （reentry guard 命中；说明已有 tick 在跑 = 也算 healthy）
#   c) has("dispatched")        （Wave 2 runScheduler 格式：{dispatched, reason, elapsed_ms}）
TICK_SUCCESS="$(echo "$TICK_RESP" | jq -r '.success // empty')"
TICK_SKIPPED="$(echo "$TICK_RESP" | jq -r '.skipped // empty')"
TICK_DISPATCHED="$(echo "$TICK_RESP" | jq -r 'if has("dispatched") then "present" else empty end')"
TICK_ERROR="$(echo "$TICK_RESP" | jq -r '.error // empty')"
if [ "$TICK_SUCCESS" = "true" ]; then
  ACTIONS_COUNT="$(echo "$TICK_RESP" | jq -r '.actions_taken | if type == "array" then length else 0 end' 2>/dev/null || echo 0)"
  pass "manual tick 跑完 actions_taken=${ACTIONS_COUNT}"
elif [ "$TICK_SKIPPED" = "true" ]; then
  SKIP_REASON="$(echo "$TICK_RESP" | jq -r '.reason // empty')"
  pass "manual tick 被 reentry guard 跳过 reason=${SKIP_REASON} (已有 tick 在跑也算健康)"
elif [ "$TICK_DISPATCHED" = "present" ]; then
  ELAPSED="$(echo "$TICK_RESP" | jq -r '.elapsed_ms // 0')"
  REASON="$(echo "$TICK_RESP" | jq -r '.reason // empty')"
  pass "manual tick 跑完（Wave 2 runScheduler 格式）elapsed_ms=${ELAPSED} reason=${REASON}"
else
  fail "manual tick 失败: success=$TICK_SUCCESS skipped=$TICK_SKIPPED error=$TICK_ERROR resp=$TICK_RESP"
fi

# 等异步写完成
sleep "$TICK_SETTLE_S"

# 3) 验 last_tick 推进 / total_executions++
echo ""
echo "[3/5] 验 last_tick 推进 + tick_stats.total_executions++"
STATUS_AFTER="$(curl -sf "$BRAIN_URL/api/brain/tick/status")"
LAST_TICK_AFTER="$(echo "$STATUS_AFTER" | jq -r '.last_tick // empty')"
EXEC_COUNT_AFTER="$(echo "$STATUS_AFTER" | jq -r '.tick_stats.total_executions // 0')"

# 至少 last_tick、total_executions 推进，或 Wave 2 格式已确认 tick 跑过（其中一个）
TICK_ADVANCED=0
if [ -n "$LAST_TICK_AFTER" ] && [ "$LAST_TICK_AFTER" != "$LAST_TICK_BEFORE" ]; then
  pass "last_tick 推进: ${LAST_TICK_BEFORE:-<null>} → $LAST_TICK_AFTER"
  TICK_ADVANCED=1
fi
if [ "$EXEC_COUNT_AFTER" -gt "$EXEC_COUNT_BEFORE" ]; then
  pass "tick_stats.total_executions: $EXEC_COUNT_BEFORE → $EXEC_COUNT_AFTER"
  TICK_ADVANCED=1
fi
# Wave 2 runScheduler 不更新 total_executions；用响应中 has("dispatched") 作为"tick 已跑"证明
if [ "$TICK_ADVANCED" -eq 0 ] && [ "$TICK_DISPATCHED" = "present" ]; then
  pass "Wave 2 tick 已跑（runScheduler 格式确认，last_tick/total_executions 由调度层维护）"
  TICK_ADVANCED=1
fi
if [ "$TICK_ADVANCED" -eq 0 ]; then
  fail "tick 未推进 (last_tick: $LAST_TICK_BEFORE → $LAST_TICK_AFTER; total_executions: $EXEC_COUNT_BEFORE → $EXEC_COUNT_AFTER)"
fi

# 4) 静态验：tick-runner.js 必须 import 8 plugin（容器内）
echo ""
echo "[4/5] 静态验：tick-runner.js import 8 plugin"

declare -a PLUGIN_IMPORTS=(
  'dept-heartbeat'
  'kr-progress-sync-plugin'
  'heartbeat-plugin'
  'goal-eval-plugin'
  'pipeline-patrol-plugin'
  'pipeline-watchdog-plugin'
  'kr-health-daily-plugin'
  'cleanup-worker-plugin'
)

docker exec "$BRAIN_CONTAINER" test -f /app/src/tick-runner.js \
  || { fail "容器内 /app/src/tick-runner.js 不存在"; exit 1; }

IMPORT_HITS=0
for plugin in "${PLUGIN_IMPORTS[@]}"; do
  if docker exec "$BRAIN_CONTAINER" grep -qF "from './${plugin}.js'" /app/src/tick-runner.js; then
    pass "import: $plugin"
    IMPORT_HITS=$((IMPORT_HITS + 1))
  else
    fail "import 缺失: $plugin"
  fi
done

[ "$IMPORT_HITS" -eq 8 ] && pass "8 plugin 全部 wired" || fail "仅 $IMPORT_HITS/8 plugin 被 import"

# 5) 软验：docker logs 至少 1 plugin 留痕（diagnostic — 不是强契约）
echo ""
echo "[5/5] 软验：docker logs plugin 痕迹（阈值 ≥${PLUGIN_RUNTIME_THRESHOLD}/8 — diagnostic）"
echo "  注意：CI 空 DB / 短窗口下多数 plugin silent on no-op；强契约由 [3/5] 兜底"

declare -a PLUGIN_LOG_PATTERNS=(
  'heartbeat|\[TICK\] Heartbeat|\[heartbeat\]'
  'dept-heartbeat|\[dept-heartbeat\]|\[tick\] dept heartbeat'
  'kr-progress-sync|\[TICK\] KR 进度同步|kr_verifier_sync|\[tick\] KR verifier'
  'goal-eval|\[goal-evaluator\]|\[tick\] goal-eval'
  'kr-health-daily|KR 可信度|\[tick\] KR health'
  'pipeline-patrol|\[pipeline-patrol\]|Pipeline patrol|\[tick\] Pipeline patrol'
  'pipeline-watchdog|pipeline-watchdog|Pipeline watchdog|\[tick\] Pipeline watchdog'
  'cleanup-worker|cleanup-worker|Orphan worktree'
)

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
    echo "  SKIP-runtime: $name (无运行时痕迹 — silent on no-op)"
    RUNTIME_MISSES+=("$name")
  fi
done

echo ""
echo "  Runtime 命中: ${RUNTIME_HITS} / 8 (阈值 ${PLUGIN_RUNTIME_THRESHOLD})"
if [ "$RUNTIME_HITS" -lt "$PLUGIN_RUNTIME_THRESHOLD" ]; then
  # 软验：仅 warn 不 fail —— CI 空 DB + 35s 短窗口下多数 plugin silent on no-op 是正常情况
  # 强契约 [3/5] 已兜底（HTTP /tick/status + tick_stats 推进）。Tier 0 hard-gate 后避免误伤。
  echo "  WARN: runtime 命中 < 阈值（强契约 [3/5] 已兜底，CI 空 DB silent 是正常 — 不计 fail）"
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
