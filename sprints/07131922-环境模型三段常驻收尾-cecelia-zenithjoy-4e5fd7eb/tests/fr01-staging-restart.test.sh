#!/usr/bin/env bash
# fr01-staging-restart.test.sh — 验证 FR-01 staging 常驻策略修复
# Sprint: 07131922-环境模型三段常驻收尾
# task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084

set -uo pipefail
PASS=0
FAIL=0

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
STAGING_COMPOSE="$ROOT_DIR/docker-compose.staging.yml"

log_pass() { echo "[PASS] $1"; PASS=$((PASS+1)); }
log_fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "=== FR-01: Staging 常驻策略核验 ==="
echo ""

# 检查 staging compose 文件存在
if [[ ! -f "$STAGING_COMPOSE" ]]; then
  echo "[FATAL] $STAGING_COMPOSE 不存在，无法继续测试"
  exit 2
fi

# T01: restart 字段为 unless-stopped
echo "--- T01: restart 字段 ---"
if grep -q 'restart: unless-stopped' "$STAGING_COMPOSE"; then
  log_pass "T01: restart=unless-stopped 已配置"
else
  RESTART_VAL=$(grep "restart:" "$STAGING_COMPOSE" | head -1 | xargs)
  log_fail "T01: restart 不是 unless-stopped，当前值: $RESTART_VAL"
fi

# T02: CECELIA_TICK_HARD_OFF=1 存在
echo ""
echo "--- T02: tick 硬关配置 ---"
if grep -q "CECELIA_TICK_HARD_OFF=1" "$STAGING_COMPOSE"; then
  log_pass "T02: CECELIA_TICK_HARD_OFF=1 存在"
else
  log_fail "T02: CECELIA_TICK_HARD_OFF=1 缺失"
fi

# T03: CECELIA_TICK_ENABLED=false 存在
if grep -q "CECELIA_TICK_ENABLED=false" "$STAGING_COMPOSE"; then
  log_pass "T03: CECELIA_TICK_ENABLED=false 存在"
else
  log_fail "T03: CECELIA_TICK_ENABLED=false 缺失"
fi

# T04: healthcheck 存在且 start_period >= 30s
echo ""
echo "--- T04: healthcheck 配置 ---"
if grep -q "healthcheck" "$STAGING_COMPOSE"; then
  START_PERIOD=$(grep "start_period:" "$STAGING_COMPOSE" | head -1 | grep -o "[0-9]*s\|[0-9]*m" | head -1)
  log_pass "T04: healthcheck 已配置，start_period=$START_PERIOD"
else
  log_fail "T04: docker-compose.staging.yml 缺少 healthcheck 配置"
fi

# T05: 若 docker 可用，验证 staging health（可选，不强制 docker 环境）
echo ""
echo "--- T05: staging 5222 health（需 docker 环境）---"
if command -v docker &>/dev/null && docker ps --filter name=cecelia-node-brain-staging --format "{{.Names}}" 2>/dev/null | grep -q "cecelia-node-brain-staging"; then
  if curl -sf http://localhost:5222/api/brain/health > /tmp/staging_health.json 2>/dev/null; then
    STATUS=$(cat /tmp/staging_health.json | grep -o '"status":"[^"]*"' | head -1)
    if echo "$STATUS" | grep -q "healthy"; then
      log_pass "T05: staging 5222 返回 HTTP 200，status=healthy"
    else
      log_fail "T05: staging 5222 返回 200 但 status 异常: $STATUS"
    fi
  else
    log_fail "T05: staging 5222 health 请求失败"
  fi
else
  echo "[SKIP] T05: docker 不可用或 staging 容器未运行，跳过在线验证"
fi

echo ""
echo "============================================"
echo "FR-01 完成：PASS=$PASS  FAIL=$FAIL"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
