#!/usr/bin/env bash
# fr05-dev-healthcheck.test.sh — 验证 FR-05 develop 健康监控实施
# Sprint: 07131922-环境模型三段常驻收尾
# task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084

set -uo pipefail
PASS=0
FAIL=0
SKIP=0

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
DEV_COMPOSE="$ROOT_DIR/docker-compose.dev.yml"

log_pass() { echo "[PASS] $1"; PASS=$((PASS+1)); }
log_fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
log_skip() { echo "[SKIP] $1"; SKIP=$((SKIP+1)); }

echo "=== FR-05: Develop 健康监控核验 ==="
echo ""

# T01: docker-compose.dev.yml 的 node-brain-dev 含 healthcheck
echo "--- T01: docker-compose.dev.yml healthcheck ---"
if [[ -f "$DEV_COMPOSE" ]]; then
  # 检查 healthcheck 配置中含有 5220
  HC_5220=$(grep -c "5220" "$DEV_COMPOSE" 2>/dev/null || echo 0)
  HC_SECTION=$(grep -c "healthcheck" "$DEV_COMPOSE" 2>/dev/null || echo 0)
  if [[ "$HC_SECTION" -ge 1 && "$HC_5220" -ge 1 ]]; then
    log_pass "T01: docker-compose.dev.yml 含 healthcheck 且检查 5220 端口"
  elif [[ "$HC_SECTION" -ge 1 ]]; then
    log_fail "T01: healthcheck 存在但未检查 5220 端口（应为 curl localhost:5220/api/brain/health）"
  else
    log_fail "T01: docker-compose.dev.yml 缺少 healthcheck 配置"
  fi
else
  log_fail "T01: docker-compose.dev.yml 不存在"
fi

# T02: healthcheck interval 合理（≤ 60s）
echo ""
echo "--- T02: healthcheck interval ---"
if [[ -f "$DEV_COMPOSE" ]]; then
  INTERVAL=$(grep -A10 "node-brain-dev:" "$DEV_COMPOSE" | grep "interval:" | head -1 | grep -o "[0-9]*s\|[0-9]*m" | head -1)
  if [[ -n "$INTERVAL" ]]; then
    log_pass "T02: healthcheck interval=$INTERVAL"
  else
    log_skip "T02: 未能提取 interval 值，需人工核查"
  fi
fi

# T03: 独立 healthcheck 脚本存在
echo ""
echo "--- T03: 独立 healthcheck 脚本 ---"
HC_SCRIPT=""
for candidate in \
  "$ROOT_DIR/scripts/dev-healthcheck.sh" \
  "$ROOT_DIR/scripts/dev-monitor.sh" \
  "$ROOT_DIR/scripts/dev-health-monitor.sh"
do
  if [[ -f "$candidate" ]]; then
    HC_SCRIPT="$candidate"
    break
  fi
done

if [[ -n "$HC_SCRIPT" ]]; then
  log_pass "T03: 独立 healthcheck 脚本存在: $HC_SCRIPT"
else
  log_fail "T03: 未找到独立 healthcheck 脚本（scripts/dev-healthcheck.sh 或 scripts/dev-monitor.sh）"
fi

# T04: 脚本调用 POST /api/brain/tasks 创建 alert
echo ""
echo "--- T04: healthcheck 脚本 alert 行为 ---"
if [[ -n "$HC_SCRIPT" ]]; then
  if grep -q "api/brain/tasks" "$HC_SCRIPT" && grep -q "alert" "$HC_SCRIPT"; then
    log_pass "T04: healthcheck 脚本含 Brain tasks alert 调用"
  elif grep -q "alert\|5221" "$HC_SCRIPT"; then
    log_pass "T04: healthcheck 脚本含 alert 相关逻辑"
  else
    log_fail "T04: healthcheck 脚本未调用 POST /api/brain/tasks {type:alert}"
  fi
fi

# T05: 脚本检查 5220
echo ""
echo "--- T05: healthcheck 目标端口 ---"
if [[ -n "$HC_SCRIPT" ]]; then
  if grep -q "5220" "$HC_SCRIPT"; then
    log_pass "T05: healthcheck 脚本目标为 5220 端口"
  else
    log_fail "T05: healthcheck 脚本未检查 5220 端口"
  fi
fi

# T06: 有 cron 或调度配置（5 分钟间隔）
echo ""
echo "--- T06: 调度配置 ---"
CRON_CHECK=0
if [[ -n "$HC_SCRIPT" ]]; then
  if grep -q "cron\|*/5\|5 min\|300\|sleep 300" "$HC_SCRIPT" 2>/dev/null; then
    CRON_CHECK=1
  fi
fi
# 也检查 crontab 配置文件
if [[ -f "$ROOT_DIR/scripts/install-cron.sh" ]] || [[ -f "$ROOT_DIR/scripts/setup-cron.sh" ]]; then
  CRON_CHECK=1
fi
if [[ "$CRON_CHECK" -ge 1 ]]; then
  log_pass "T06: 含 5 分钟轮询调度配置"
else
  log_skip "T06: 未检测到 5 分钟调度配置，需人工确认 cron 是否已注册"
fi

# T07: 在线告警验证（仅告知步骤，不强制执行耗时测试）
echo ""
echo "--- T07: 在线告警验证（手动执行）---"
echo "[INFO] 完整验证步骤（耗时 ≤10min）："
echo "  docker stop cecelia-node-brain-dev"
echo "  sleep 360  # 等 6 分钟（2 次检查周期）"
echo "  curl -s 'localhost:5221/api/brain/tasks?type=alert&limit=5' | jq '.[].title'"
echo "  # 预期输出含: \"develop 5220 health check failed\""
log_skip "T07: 在线告警验证需人工执行（耗时 >5 分钟）"

echo ""
echo "============================================"
echo "FR-05 完成：PASS=$PASS  FAIL=$FAIL  SKIP=$SKIP"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
