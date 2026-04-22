#!/usr/bin/env bash
# Brain Docker 基础设施本机 smoke 测试
# 用法：改 docker-compose.yml / packages/brain/Dockerfile / brain-docker-*.sh 前
#       跑一次确认当前 main 的 Docker 化链路完整能用
#
# 输出：7 步各自 pass/fail + 总结。任一 step fail 退 1。
# 副作用：trap EXIT 兜底 brain-docker-down.sh，保证现场不残留。

set +e  # 让每 step 独立判 pass/fail，最后统一退出码

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

declare -a RESULTS
declare -a NAMES

record() {
  NAMES+=("$1")
  RESULTS+=("$2")  # PASS | FAIL
  printf "  [%s] %s\n" "$([ "$2" = "PASS" ] && echo '✓' || echo '✗')" "$1"
}

cleanup_on_exit() {
  echo ""
  echo "=== 清理：回滚到裸跑 Brain（幂等）==="
  bash "$ROOT_DIR/scripts/brain-docker-down.sh" 2>&1 | tail -3 || true
}
trap cleanup_on_exit EXIT

echo "=== Brain Docker 基础设施 Smoke ==="
echo "开始: $(date '+%H:%M:%S')"
echo ""

# ── Step 1: docker build ──
echo "→ Step 1: docker build"
if docker build -f packages/brain/Dockerfile -t cecelia-brain:smoke-ci . > /tmp/smoke-step1.log 2>&1; then
  record "Step 1: docker build" PASS
else
  record "Step 1: docker build" FAIL
  tail -20 /tmp/smoke-step1.log
fi

# ── Step 2: 依赖解析 ──
echo "→ Step 2: node require 关键 deps"
if docker run --rm cecelia-brain:smoke-ci node -e "require('@langchain/langgraph');require('@langchain/langgraph-checkpoint-postgres');require('express');console.log('ok')" > /tmp/smoke-step2.log 2>&1; then
  record "Step 2: deps resolved" PASS
else
  record "Step 2: deps resolved" FAIL
  tail -10 /tmp/smoke-step2.log
fi

# ── Step 3: compose config ──
echo "→ Step 3: docker compose config"
# 建空 .env.docker（如已有则保留；smoke 不破坏现场）
[ -f .env.docker ] || : > .env.docker
if docker compose -f docker-compose.yml config > /tmp/smoke-step3.log 2>&1; then
  record "Step 3: compose config" PASS
else
  record "Step 3: compose config" FAIL
  tail -10 /tmp/smoke-step3.log
fi

# ── Step 4: brain-docker-up 切换（Mac 专属）──
echo "→ Step 4: brain-docker-up.sh（切换裸跑 → 容器）"
if bash scripts/brain-docker-up.sh > /tmp/smoke-step4.log 2>&1; then
  record "Step 4: brain-docker-up" PASS
else
  record "Step 4: brain-docker-up" FAIL
  tail -20 /tmp/smoke-step4.log
fi

# ── Step 5: HTTP 健康 ──
echo "→ Step 5: curl 5221 健康"
if curl -fs http://localhost:5221/api/brain/tick/status > /tmp/smoke-step5.log 2>&1 && grep -q '"enabled":true' /tmp/smoke-step5.log; then
  record "Step 5: HTTP 5221 healthy" PASS
else
  record "Step 5: HTTP 5221 healthy" FAIL
  tail -10 /tmp/smoke-step5.log
fi

# ── Step 6: 容器内 docker CLI + host.docker.internal 通 ──
echo "→ Step 6: 容器内 docker CLI + host.docker.internal"
if docker exec cecelia-node-brain sh -c 'docker ps --format "{{.Names}}" | grep -q cecelia-node-brain && nc -zv host.docker.internal 5432' > /tmp/smoke-step6.log 2>&1; then
  record "Step 6: container docker + host.docker.internal" PASS
else
  record "Step 6: container docker + host.docker.internal" FAIL
  tail -10 /tmp/smoke-step6.log
fi

# ── Step 7: 自愈（kill -TERM 1 → Docker auto-restart）──
echo "→ Step 7: 自愈（kill -TERM PID 1，15s 内恢复 healthy）"
BEFORE_START=$(docker inspect -f '{{.State.StartedAt}}' cecelia-node-brain 2>/dev/null || echo "")
docker exec cecelia-node-brain kill -TERM 1 2>/dev/null || true
sleep 15
AFTER_START=$(docker inspect -f '{{.State.StartedAt}}' cecelia-node-brain 2>/dev/null || echo "")
STATUS=$(docker inspect -f '{{.State.Health.Status}}' cecelia-node-brain 2>/dev/null || echo "missing")
if [ "$BEFORE_START" != "$AFTER_START" ] && [ "$STATUS" = "healthy" ]; then
  record "Step 7: auto-restart" PASS
else
  record "Step 7: auto-restart" FAIL
  echo "  Before: $BEFORE_START"
  echo "  After:  $AFTER_START"
  echo "  Status: $STATUS"
fi

# ── 总结 ──
echo ""
echo "=== Smoke Summary ==="
PASS_COUNT=0
FAIL_COUNT=0
for i in "${!NAMES[@]}"; do
  if [ "${RESULTS[$i]}" = "PASS" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done
echo "Total: ${PASS_COUNT}/${#NAMES[@]} PASSED"
echo "结束: $(date '+%H:%M:%S')"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
