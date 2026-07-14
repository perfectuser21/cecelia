#!/usr/bin/env bash
# invariants.test.sh — 核验所有不变量（Invariants）
# Sprint: 07131922-环境模型三段常驻收尾
# task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084

set -uo pipefail
PASS=0
FAIL=0
SKIP=0

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

log_pass() { echo "[PASS] $1"; PASS=$((PASS+1)); }
log_fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
log_skip() { echo "[SKIP] $1"; SKIP=$((SKIP+1)); }

echo "=== Invariant 不变量核验 ==="
echo "ROOT_DIR: $ROOT_DIR"
echo ""

# INV-2: Production 5221 全程不中断
echo "--- INV-2: Production 5221 不中断 ---"
if curl -sf http://localhost:5221/api/brain/health > /tmp/inv2_health.json 2>/dev/null; then
  STATUS=$(cat /tmp/inv2_health.json | grep -o '"status":"[^"]*"' | head -1)
  if echo "$STATUS" | grep -q "healthy"; then
    log_pass "INV-2: production 5221 返回 HTTP 200，status=healthy"
  else
    log_fail "INV-2: production 5221 返回 200 但 status 非 healthy: $STATUS"
  fi
else
  log_fail "INV-2: production 5221 health 请求失败（connection refused 或非 200）"
fi

# INV-3: staging tick 永远硬关
echo ""
echo "--- INV-3: staging tick 硬关 ---"
STAGING_COMPOSE="$ROOT_DIR/docker-compose.staging.yml"
if [[ -f "$STAGING_COMPOSE" ]]; then
  TICK_HARD_OFF=$(grep -c "CECELIA_TICK_HARD_OFF=1" "$STAGING_COMPOSE" 2>/dev/null || echo 0)
  TICK_DISABLED=$(grep -c "CECELIA_TICK_ENABLED=false" "$STAGING_COMPOSE" 2>/dev/null || echo 0)
  if [[ "$TICK_HARD_OFF" -ge 1 ]]; then
    log_pass "INV-3: CECELIA_TICK_HARD_OFF=1 存在于 docker-compose.staging.yml"
  else
    log_fail "INV-3: docker-compose.staging.yml 缺少 CECELIA_TICK_HARD_OFF=1"
  fi
  if [[ "$TICK_DISABLED" -ge 1 ]]; then
    log_pass "INV-3: CECELIA_TICK_ENABLED=false 存在于 docker-compose.staging.yml"
  else
    log_fail "INV-3: docker-compose.staging.yml 缺少 CECELIA_TICK_ENABLED=false"
  fi
else
  log_fail "INV-3: docker-compose.staging.yml 文件不存在: $STAGING_COMPOSE"
fi

# INV-1: staging restart=unless-stopped（三段常驻不可回退）
echo ""
echo "--- INV-1: staging restart=unless-stopped ---"
if [[ -f "$STAGING_COMPOSE" ]]; then
  if grep -q 'restart: unless-stopped' "$STAGING_COMPOSE" 2>/dev/null; then
    log_pass "INV-1: staging restart=unless-stopped（不含 restart: \"no\"）"
  elif grep -q 'restart: "no"' "$STAGING_COMPOSE" 2>/dev/null || grep -q "restart: 'no'" "$STAGING_COMPOSE" 2>/dev/null; then
    log_fail "INV-1: staging 仍是 restart: no，三段常驻格局未修复"
  else
    log_skip "INV-1: restart 配置行未找到，需人工确认"
  fi
fi

# INV-4: dev-deploy.sh 包含 pg_dump 到 /opt/cecelia-backups/
echo ""
echo "--- INV-4: migrate 前备份 ---"
DEV_DEPLOY="$ROOT_DIR/scripts/dev-deploy.sh"
if [[ -f "$DEV_DEPLOY" ]]; then
  if grep -q "pg_dump" "$DEV_DEPLOY" && grep -q "/opt/cecelia-backups" "$DEV_DEPLOY"; then
    log_pass "INV-4: dev-deploy.sh 含 pg_dump + /opt/cecelia-backups 路径"
  elif grep -q "pg_dump" "$DEV_DEPLOY"; then
    log_fail "INV-4: dev-deploy.sh 含 pg_dump 但备份路径不是 /opt/cecelia-backups（需检查）"
  else
    log_fail "INV-4: dev-deploy.sh 缺少 pg_dump 备份步骤"
  fi
else
  log_fail "INV-4: scripts/dev-deploy.sh 不存在，FR-02 未实施"
fi

# INV-6: ZenithJoy 侧不修改（ZJ_DEV_PORT 占位在 staging-e2e-runner.js）
echo ""
echo "--- INV-6: ZenithJoy 联动占位 ---"
RUNNER="$ROOT_DIR/packages/brain/src/staging-e2e-runner.js"
if [[ -f "$RUNNER" ]]; then
  if grep -q "ZJ_DEV_PORT" "$RUNNER"; then
    log_pass "INV-6: staging-e2e-runner.js 含 ZJ_DEV_PORT 占位"
  else
    log_fail "INV-6: staging-e2e-runner.js 缺少 ZJ_DEV_PORT 占位（FR-06 未实施）"
  fi
else
  log_fail "INV-6: staging-e2e-runner.js 不存在"
fi

echo ""
echo "============================================"
echo "核验完成：PASS=$PASS  FAIL=$FAIL  SKIP=$SKIP"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
