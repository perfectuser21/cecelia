#!/usr/bin/env bash
# dev-verify.sh — Cecelia develop 环境健康验证
# 验证 5220 端口健康 + cecelia_dev DB 可访问
# Sprint: 07131922-环境模型三段常驻收尾
# task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084

set -uo pipefail

DB_NAME="cecelia_dev"
DB_USER="${DB_USER:-cecelia}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
BRAIN_PORT=5220
PASS=0
FAIL=0

log_pass() { echo "[PASS] $1"; PASS=$((PASS+1)); }
log_fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "=== Cecelia Develop 环境验证 ==="

# 检查 5220 Brain 健康端点
echo ""
echo "--- 5220 Brain 健康检查 ---"
if curl -sf "http://localhost:${BRAIN_PORT}/api/brain/health" > /tmp/dev_health.json 2>/dev/null; then
  STATUS=$(cat /tmp/dev_health.json | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ "$STATUS" == "healthy" ]]; then
    log_pass "5220 Brain 返回 HTTP 200，status=healthy"
  else
    log_fail "5220 Brain 返回 200 但 status 异常: $STATUS"
  fi
else
  log_fail "5220 Brain 健康检查失败（curl localhost:5220/api/brain/health）"
fi

# 检查 cecelia_dev DB 可访问
echo ""
echo "--- cecelia_dev DB 检查 ---"
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
  log_pass "cecelia_dev 数据库存在且可访问"

  # 检查 schema_version 表
  VERSION=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -tAc "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;" 2>/dev/null || echo "")
  if [[ -n "$VERSION" ]]; then
    log_pass "cecelia_dev schema_version=$VERSION"
  else
    log_fail "cecelia_dev schema_version 表不存在或无记录"
  fi
else
  log_fail "cecelia_dev 数据库不可访问（psql -U ${DB_USER} -lqt | grep ${DB_NAME}）"
fi

echo ""
echo "============================================"
echo "develop 验证完成：PASS=$PASS  FAIL=$FAIL"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
