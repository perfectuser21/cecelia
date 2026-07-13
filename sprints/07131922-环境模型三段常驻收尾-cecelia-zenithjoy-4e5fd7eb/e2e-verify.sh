#!/usr/bin/env bash
# e2e-verify.sh — Sprint 07131922 环境模型三段常驻收尾 E2E 验收脚本
# task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084
#
# 运行全部合同 BEHAVIOR 的静态验收检查：
#   - BEHAVIOR-01/06: Staging tick 双保险 + restart=unless-stopped
#   - BEHAVIOR-03: dev-deploy.sh 规范
#   - BEHAVIOR-04: develop 健康监控
#   - BEHAVIOR-05: Brain deploy/dev 端点
#   - BEHAVIOR-07: ZJ_DEV_PORT 占位 + DEFINITION.md

set -uo pipefail

SPRINT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SPRINT_DIR/../.." && pwd)"
PASS=0
FAIL=0
SKIP=0

log_pass() { echo "[PASS] $1"; PASS=$((PASS+1)); }
log_fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
log_skip() { echo "[SKIP] $1"; SKIP=$((SKIP+1)); }

echo "======================================================"
echo "Sprint 07131922 三段常驻收尾 — E2E 验收脚本"
echo "task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084"
echo "======================================================"
echo ""

# ---- BEHAVIOR-01: Staging restart=unless-stopped ----
echo "=== BEHAVIOR-01: Staging 常驻策略 ==="
if grep -q "restart: unless-stopped" "$ROOT_DIR/docker-compose.staging.yml" 2>/dev/null; then
  log_pass "BEHAVIOR-01: docker-compose.staging.yml restart=unless-stopped"
else
  log_fail "BEHAVIOR-01: docker-compose.staging.yml restart 不是 unless-stopped"
fi

# ---- BEHAVIOR-06: Staging tick 双保险（两个变量同时存在）----
echo ""
echo "=== BEHAVIOR-06: Staging Tick 永远硬关 ==="
TICK_OFF_COUNT=$(grep -c "CECELIA_TICK_HARD_OFF=1\|CECELIA_TICK_ENABLED=false" \
  "$ROOT_DIR/docker-compose.staging.yml" 2>/dev/null || echo 0)
if [[ "$TICK_OFF_COUNT" -ge 2 ]]; then
  log_pass "BEHAVIOR-06: staging tick 双保险完整（count=$TICK_OFF_COUNT）"
else
  log_fail "BEHAVIOR-06: staging tick 双保险不完整（count=$TICK_OFF_COUNT，期望>=2）"
fi

# ---- BEHAVIOR-03: dev-deploy.sh ----
echo ""
echo "=== BEHAVIOR-03: Develop 部署脚本 ==="
DEV_DEPLOY="$ROOT_DIR/scripts/dev-deploy.sh"
if [[ -f "$DEV_DEPLOY" ]]; then
  log_pass "BEHAVIOR-03-T01: scripts/dev-deploy.sh 存在"
  grep -q "pg_dump" "$DEV_DEPLOY" && log_pass "BEHAVIOR-03-T02: 含 pg_dump" || log_fail "BEHAVIOR-03-T02: 缺少 pg_dump"
  grep -q "/opt/cecelia-backups" "$DEV_DEPLOY" && log_pass "BEHAVIOR-03-T03: 备份路径 /opt/cecelia-backups" || log_fail "BEHAVIOR-03-T03: 缺少 /opt/cecelia-backups"
  grep -qE "exit [1-9]|exit \$" "$DEV_DEPLOY" && log_pass "BEHAVIOR-03-T04: 含 exit 非0" || log_fail "BEHAVIOR-03-T04: 缺少 exit 非0"
  grep -q "psql.*cecelia_dev\|回滚\|rollback" "$DEV_DEPLOY" && log_pass "BEHAVIOR-03-T05: 含回滚指引" || log_fail "BEHAVIOR-03-T05: 缺少回滚指引"
else
  log_fail "BEHAVIOR-03: scripts/dev-deploy.sh 不存在"
fi

# ---- BEHAVIOR-04: develop 健康监控 ----
echo ""
echo "=== BEHAVIOR-04: Develop 健康监控 ==="
if [[ -f "$ROOT_DIR/scripts/dev-healthcheck.sh" ]]; then
  log_pass "BEHAVIOR-04-T01: scripts/dev-healthcheck.sh 存在"
  grep -q "5220" "$ROOT_DIR/scripts/dev-healthcheck.sh" && log_pass "BEHAVIOR-04-T02: 监控 5220 端口" || log_fail "BEHAVIOR-04-T02: 未监控 5220"
  grep -q "api/brain/tasks" "$ROOT_DIR/scripts/dev-healthcheck.sh" && log_pass "BEHAVIOR-04-T03: 含 alert 创建逻辑" || log_fail "BEHAVIOR-04-T03: 缺少 alert 逻辑"
else
  log_fail "BEHAVIOR-04: scripts/dev-healthcheck.sh 不存在"
fi

if grep -q "5220" "$ROOT_DIR/docker-compose.dev.yml" 2>/dev/null && grep -q "healthcheck" "$ROOT_DIR/docker-compose.dev.yml" 2>/dev/null; then
  log_pass "BEHAVIOR-04-T04: docker-compose.dev.yml 含 5220 healthcheck"
else
  log_fail "BEHAVIOR-04-T04: docker-compose.dev.yml 缺少 5220 healthcheck"
fi

# ---- BEHAVIOR-05: Brain deploy/dev 端点 ----
echo ""
echo "=== BEHAVIOR-05: Brain Deploy Dev 端点 ==="
DEPLOY_ROUTE="$ROOT_DIR/packages/brain/src/routes/deploy-dev.js"
if [[ -f "$DEPLOY_ROUTE" ]]; then
  log_pass "BEHAVIOR-05-T01: packages/brain/src/routes/deploy-dev.js 存在"
  grep -q "deploy/dev/status" "$DEPLOY_ROUTE" && log_pass "BEHAVIOR-05-T02: 含 /deploy/dev/status 端点" || log_fail "BEHAVIOR-05-T02: 缺少 /deploy/dev/status"
else
  log_fail "BEHAVIOR-05: Brain deploy-dev.js 路由不存在"
fi

DEPLOY_TEST="$ROOT_DIR/packages/brain/src/__tests__/deploy-dev.test.js"
if [[ -f "$DEPLOY_TEST" ]]; then
  log_pass "BEHAVIOR-05-T03: deploy-dev 单元测试存在"
else
  log_fail "BEHAVIOR-05-T03: deploy-dev 单元测试缺失"
fi

if [[ -f "$ROOT_DIR/.github/workflows/auto-dev-deploy.yml" ]]; then
  log_pass "BEHAVIOR-05-T04: auto-dev-deploy.yml CI workflow 存在"
  grep -q "develop" "$ROOT_DIR/.github/workflows/auto-dev-deploy.yml" && log_pass "BEHAVIOR-05-T05: workflow 监听 develop 分支" || log_fail "BEHAVIOR-05-T05: workflow 缺少 develop 触发"
  grep -q "deploy-environment" "$ROOT_DIR/.github/workflows/auto-dev-deploy.yml" && log_pass "BEHAVIOR-05-T06: concurrency group=deploy-environment" || log_fail "BEHAVIOR-05-T06: 缺少 concurrency group"
  grep -q "cancel-in-progress: false" "$ROOT_DIR/.github/workflows/auto-dev-deploy.yml" && log_pass "BEHAVIOR-05-T07: cancel-in-progress=false" || log_fail "BEHAVIOR-05-T07: 缺少 cancel-in-progress=false"
  grep -q "timeout-minutes" "$ROOT_DIR/.github/workflows/auto-dev-deploy.yml" && log_pass "BEHAVIOR-05-T08: 含 timeout-minutes" || log_fail "BEHAVIOR-05-T08: 缺少 timeout-minutes"
else
  log_fail "BEHAVIOR-05-T04: .github/workflows/auto-dev-deploy.yml 不存在"
fi

# ---- BEHAVIOR-07: ZJ_DEV_PORT + DEFINITION.md ----
echo ""
echo "=== BEHAVIOR-07: ZenithJoy 联动占位 ==="
if grep -q "ZJ_DEV_PORT" "$ROOT_DIR/packages/brain/src/staging-e2e-runner.js" 2>/dev/null; then
  log_pass "BEHAVIOR-07-T01: staging-e2e-runner.js 含 ZJ_DEV_PORT"
else
  log_fail "BEHAVIOR-07-T01: staging-e2e-runner.js 缺少 ZJ_DEV_PORT"
fi

if grep -in "develop.*环境\|develop environment\|三段常驻\|develop 环境" "$ROOT_DIR/DEFINITION.md" 2>/dev/null | grep -q .; then
  log_pass "BEHAVIOR-07-T02: DEFINITION.md 含 develop 环境章节"
else
  log_fail "BEHAVIOR-07-T02: DEFINITION.md 缺少 develop 章节"
fi

# ---- Smoke 测试 ----
echo ""
echo "=== Smoke 烟雾测试 ==="
SMOKE_SCRIPT="$ROOT_DIR/packages/brain/scripts/smoke/three-tier-smoke.sh"
if [[ -f "$SMOKE_SCRIPT" ]]; then
  log_pass "three-tier-smoke.sh 存在"
else
  log_fail "packages/brain/scripts/smoke/three-tier-smoke.sh 不存在"
fi
if grep -q "three-tier-smoke.sh" "$ROOT_DIR/packages/quality/smoke-allowlist.txt" 2>/dev/null; then
  log_pass "smoke-allowlist.txt 已注册 three-tier-smoke.sh"
else
  log_fail "smoke-allowlist.txt 未注册 three-tier-smoke.sh"
fi

# ---- 在线验证（可选）----
echo ""
echo "=== 在线验证（可选，需运行环境）==="
if curl -sf "http://localhost:5221/api/brain/health" > /dev/null 2>&1; then
  log_pass "Production 5221 在线且健康"
else
  log_skip "Production 5221 不可访问（非强制失败）"
fi

echo ""
echo "======================================================"
echo "E2E 验收完成：PASS=$PASS  FAIL=$FAIL  SKIP=$SKIP"
echo "======================================================"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "VERDICT: FAIL（$FAIL 项未通过）"
  exit 1
fi

echo ""
echo "VERDICT: PASS（所有 BEHAVIOR 验收通过）"
exit 0
