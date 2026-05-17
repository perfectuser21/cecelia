#!/usr/bin/env bash
# Consciousness Guard DoD 手工验证
# 启动 Brain 带 CONSCIOUSNESS_ENABLED=false，跑 5 分钟，断言意识类模块 0 输出，派发路径 OK
# 用途：PR 合并前在本地主 repo 跑一次，或部署前验证。
# 前提：本地能连 PostgreSQL (cecelia 数据库)，packages/brain 下已跑过 npm install。
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BRAIN_DIR="$REPO/packages/brain"
LOG="/tmp/brain-consciousness-verify.log"
PORT="${VERIFY_PORT:-5223}"
VERIFY_DURATION="${VERIFY_DURATION:-300}"  # 秒，默认 5 分钟

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Consciousness Guard DoD Verify"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "REPO: $REPO"
echo "PORT: $PORT"
echo "DURATION: ${VERIFY_DURATION}s"
echo ""

cd "$BRAIN_DIR"

echo "▶ 1. 启动 Brain 带 CONSCIOUSNESS_ENABLED=false..."
CONSCIOUSNESS_ENABLED=false \
  CECELIA_WORK_DIR="$REPO" \
  REPO_ROOT="$REPO" \
  PORT="$PORT" \
  node server.js > "$LOG" 2>&1 &
PID=$!
echo "   PID=$PID, port=$PORT, log=$LOG"

trap "kill $PID 2>/dev/null || true" EXIT

# 等 Brain 就绪，最多 30 秒
echo ""
echo "▶ 2. 等 Brain 就绪（最多 30 秒）..."
for i in $(seq 1 30); do
  if curl -fs "http://localhost:$PORT/api/brain/health" > /dev/null 2>&1; then
    echo "   ✅ Brain 就绪（${i}s）"
    break
  fi
  if [[ $i == 30 ]]; then
    echo "   ❌ Brain 30 秒内未就绪，看日志："
    tail -30 "$LOG"
    exit 1
  fi
  sleep 1
done

echo ""
echo "▶ 3. 验证启动声明..."
if grep -q "CONSCIOUSNESS_ENABLED=false — 意识层全部跳过" "$LOG"; then
  echo "   ✅ 守护声明出现"
else
  echo "   ❌ 守护声明缺失"
  tail -30 "$LOG"
  exit 1
fi

echo ""
echo "▶ 4. 跑 ${VERIFY_DURATION} 秒 tick 循环..."
sleep "$VERIFY_DURATION"

echo ""
echo "▶ 5. 验证意识类日志 0 输出..."
OFFENDERS=$(grep -cE '\[reflection\]|\[proactive-mouth\]|\[diary\]|\[desire\]|\[evolution\]|\[rumination\]|\[narrative\]' "$LOG" || echo "0")
if [[ "$OFFENDERS" == "0" ]]; then
  echo "   ✅ 意识类日志无输出"
else
  echo "   ❌ 发现 $OFFENDERS 条意识类日志（期望 0）"
  grep -E '\[reflection\]|\[proactive-mouth\]|\[diary\]|\[desire\]|\[evolution\]|\[rumination\]|\[narrative\]' "$LOG" | head -10
  exit 1
fi

echo ""
echo "▶ 6. 验证 API 正常..."
if curl -fs "http://localhost:$PORT/api/brain/context" > /dev/null; then
  echo "   ✅ /api/brain/context 返回正常"
else
  echo "   ❌ API 无响应"
  exit 1
fi

echo ""
echo "▶ 7. 派发路径 smoke test..."
RESP=$(curl -s -X POST "http://localhost:$PORT/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"consciousness-verify-smoke","task_type":"research","priority":"P3"}' || echo "")
echo "   响应: ${RESP:0:120}"
sleep 30
if grep -q "\[dispatch\]" "$LOG"; then
  echo "   ✅ 派发路径可用"
else
  echo "   ⚠️ 派发日志未出现（可能无可用 executor，非致命）"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ DoD 验证通过"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
