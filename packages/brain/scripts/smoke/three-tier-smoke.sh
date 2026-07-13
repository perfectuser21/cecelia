#!/usr/bin/env bash
# three-tier-smoke.sh — Cecelia 三段常驻环境烟雾测试
# 验证 Production(5221) / Staging(5222) / Develop(5220) 的关键配置不变量
#
# BEHAVIOR-06 回归防护：staging tick 永远硬关
# Sprint: 07131922-环境模型三段常驻收尾
# task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084
#
# 用法：bash packages/brain/scripts/smoke/three-tier-smoke.sh
# CI：由 packages/quality/smoke-allowlist.txt 注册后，ci-smoke-glob-runner.yml 自动调用

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
STAGING_COMPOSE="$ROOT_DIR/docker-compose.staging.yml"
DEV_COMPOSE="$ROOT_DIR/docker-compose.dev.yml"

log_pass() { echo "[PASS] $1"; PASS=$((PASS+1)); }
log_fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
log_skip() { echo "[SKIP] $1"; SKIP=$((SKIP+1)); }

echo "=== Cecelia 三段常驻环境烟雾测试 ==="
echo ""

# ---- BEHAVIOR-01/BEHAVIOR-06: Staging tick 双保险（核心回归防护）----
echo "--- [BEHAVIOR-01/BEHAVIOR-06] Staging 常驻策略 + Tick 硬关 ---"

if [[ ! -f "$STAGING_COMPOSE" ]]; then
  log_fail "docker-compose.staging.yml 不存在"
else
  # T01: restart=unless-stopped
  if grep -q "restart: unless-stopped" "$STAGING_COMPOSE"; then
    log_pass "Staging restart=unless-stopped（宿主重启自动恢复）"
  else
    RESTART_VAL=$(grep "restart:" "$STAGING_COMPOSE" | head -1 | xargs || echo "未配置")
    log_fail "Staging restart 不是 unless-stopped，当前: $RESTART_VAL"
  fi

  # T02: CECELIA_TICK_HARD_OFF=1
  if grep -q "CECELIA_TICK_HARD_OFF=1" "$STAGING_COMPOSE"; then
    log_pass "Staging CECELIA_TICK_HARD_OFF=1（tick 硬关）"
  else
    log_fail "Staging 缺少 CECELIA_TICK_HARD_OFF=1（严重：staging tick 可能越权）"
  fi

  # T03: CECELIA_TICK_ENABLED=false
  if grep -q "CECELIA_TICK_ENABLED=false" "$STAGING_COMPOSE"; then
    log_pass "Staging CECELIA_TICK_ENABLED=false（双保险）"
  else
    log_fail "Staging 缺少 CECELIA_TICK_ENABLED=false（tick 双保险不完整）"
  fi

  # T04: 两个 tick 关闭变量同时存在（grep count=2）
  TICK_OFF_COUNT=$(grep -c "CECELIA_TICK_HARD_OFF=1\|CECELIA_TICK_ENABLED=false" "$STAGING_COMPOSE" 2>/dev/null || echo 0)
  if [[ "$TICK_OFF_COUNT" -ge 2 ]]; then
    log_pass "Staging tick 双保险完整（count=$TICK_OFF_COUNT）"
  else
    log_fail "Staging tick 双保险不完整（count=$TICK_OFF_COUNT，期望>=2）"
  fi
fi

echo ""

# ---- Develop 配置核验 ----
echo "--- [FR-05] Develop 健康监控配置 ---"

if [[ ! -f "$DEV_COMPOSE" ]]; then
  log_fail "docker-compose.dev.yml 不存在"
else
  # T05: node-brain-dev 含 5220 healthcheck
  HC_5220=$(grep -c "5220" "$DEV_COMPOSE" 2>/dev/null || echo 0)
  HC_SECTION=$(grep -c "healthcheck" "$DEV_COMPOSE" 2>/dev/null || echo 0)
  if [[ "$HC_SECTION" -ge 1 && "$HC_5220" -ge 1 ]]; then
    log_pass "docker-compose.dev.yml 含 5220 healthcheck"
  else
    log_fail "docker-compose.dev.yml 缺少 5220 healthcheck（count: healthcheck=$HC_SECTION, 5220=$HC_5220）"
  fi
fi

echo ""

# ---- FR-02: 脚本存在 ----
echo "--- [FR-02] Develop 部署脚本 ---"

if [[ -f "$ROOT_DIR/scripts/dev-deploy.sh" ]]; then
  log_pass "scripts/dev-deploy.sh 存在"
  if grep -q "pg_dump" "$ROOT_DIR/scripts/dev-deploy.sh"; then
    log_pass "dev-deploy.sh 含 pg_dump 备份"
  else
    log_fail "dev-deploy.sh 缺少 pg_dump 备份"
  fi
else
  log_fail "scripts/dev-deploy.sh 不存在"
fi

if [[ -f "$ROOT_DIR/scripts/dev-verify.sh" ]]; then
  log_pass "scripts/dev-verify.sh 存在"
else
  log_fail "scripts/dev-verify.sh 不存在"
fi

echo ""

# ---- FR-03: Brain deploy/dev 端点 ----
echo "--- [FR-03] Brain deploy/dev 端点 ---"

DEPLOY_DEV_ROUTE="$ROOT_DIR/packages/brain/src/routes/deploy-dev.js"
if [[ -f "$DEPLOY_DEV_ROUTE" ]]; then
  log_pass "packages/brain/src/routes/deploy-dev.js 存在"
  if grep -q "deploy.*dev\|dev.*deploy" "$DEPLOY_DEV_ROUTE"; then
    log_pass "deploy-dev.js 含 dev 部署端点逻辑"
  fi
else
  log_fail "packages/brain/src/routes/deploy-dev.js 不存在（FR-03 未实施）"
fi

if [[ -f "$ROOT_DIR/.github/workflows/auto-dev-deploy.yml" ]]; then
  log_pass ".github/workflows/auto-dev-deploy.yml 存在"
else
  log_fail ".github/workflows/auto-dev-deploy.yml 不存在"
fi

echo ""

# ---- FR-06 / BEHAVIOR-07: ZJ_DEV_PORT 占位 ----
echo "--- [BEHAVIOR-07] ZenithJoy 联动占位 ---"

STAGING_E2E="$ROOT_DIR/packages/brain/src/staging-e2e-runner.js"
if [[ -f "$STAGING_E2E" ]]; then
  if grep -q "ZJ_DEV_PORT" "$STAGING_E2E"; then
    log_pass "staging-e2e-runner.js 含 ZJ_DEV_PORT 常量占位"
  else
    log_fail "staging-e2e-runner.js 缺少 ZJ_DEV_PORT 占位"
  fi
else
  log_fail "staging-e2e-runner.js 不存在"
fi

if grep -in "develop.*环境\|develop environment\|三段常驻\|develop 环境" "$ROOT_DIR/DEFINITION.md" 2>/dev/null | head -1 | grep -q .; then
  log_pass "DEFINITION.md 含 develop 环境章节"
else
  log_fail "DEFINITION.md 缺少 develop 环境章节"
fi

echo ""

# ---- 在线健康检查（可选，需实际环境）----
echo "--- 在线健康检查（可选）---"

for PORT in 5221 5222 5220; do
  LABEL="production(5221)"
  [[ "$PORT" == "5222" ]] && LABEL="staging(5222)"
  [[ "$PORT" == "5220" ]] && LABEL="develop(5220)"
  if curl -sf "http://localhost:${PORT}/api/brain/health" > /dev/null 2>&1; then
    log_pass "${LABEL} 在线且健康"
  else
    log_skip "${LABEL} 不可访问（非 CI 失败，可能未启动）"
  fi
done

echo ""
echo "============================================"
echo "三段 smoke 完成：PASS=$PASS  FAIL=$FAIL  SKIP=$SKIP"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
