#!/usr/bin/env bash
# fr02-dev-deploy.test.sh — 验证 FR-02 dev-deploy.sh 脚本存在并符合规范
# Sprint: 07131922-环境模型三段常驻收尾
# task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084

set -uo pipefail
PASS=0
FAIL=0

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
DEV_DEPLOY="$ROOT_DIR/scripts/dev-deploy.sh"
DEV_VERIFY="$ROOT_DIR/scripts/dev-verify.sh"

log_pass() { echo "[PASS] $1"; PASS=$((PASS+1)); }
log_fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "=== FR-02: Develop 部署脚本核验 ==="
echo ""

# T01: dev-deploy.sh 存在
echo "--- T01: dev-deploy.sh 存在性 ---"
if [[ -f "$DEV_DEPLOY" ]]; then
  log_pass "T01: scripts/dev-deploy.sh 存在"
else
  log_fail "T01: scripts/dev-deploy.sh 不存在（FR-02 未实施）"
fi

# T02: 含 pg_dump 备份步骤
echo ""
echo "--- T02: pg_dump 备份 ---"
if [[ -f "$DEV_DEPLOY" ]]; then
  if grep -q "pg_dump" "$DEV_DEPLOY"; then
    log_pass "T02: dev-deploy.sh 含 pg_dump"
  else
    log_fail "T02: dev-deploy.sh 缺少 pg_dump 备份"
  fi
fi

# T03: 备份路径为 /opt/cecelia-backups/（非 /tmp）
echo ""
echo "--- T03: 备份路径 ---"
if [[ -f "$DEV_DEPLOY" ]]; then
  if grep -q "/opt/cecelia-backups" "$DEV_DEPLOY"; then
    log_pass "T03: 备份路径含 /opt/cecelia-backups（持久路径）"
  else
    BACKUP_PATH=$(grep -o "/tmp[^'\"]*\|/var[^'\"]*" "$DEV_DEPLOY" | head -1)
    if [[ -n "$BACKUP_PATH" ]]; then
      log_fail "T03: 备份路径使用了非持久路径: $BACKUP_PATH，应为 /opt/cecelia-backups"
    else
      log_fail "T03: 未找到备份路径配置"
    fi
  fi
fi

# T04: 含保留 7 份逻辑
echo ""
echo "--- T04: 备份保留策略 ---"
if [[ -f "$DEV_DEPLOY" ]]; then
  if grep -qE "7|tail|head|ls.*sort" "$DEV_DEPLOY" && grep -q "cecelia-backups" "$DEV_DEPLOY"; then
    log_pass "T04: 含备份清理/保留策略"
  else
    echo "[WARN] T04: 未检测到明确的 7 份保留策略，需人工核查"
  fi
fi

# T05: migrate 失败 exit 非 0
echo ""
echo "--- T05: migrate 失败处理 ---"
if [[ -f "$DEV_DEPLOY" ]]; then
  if grep -qE "exit [1-9]|exit \$" "$DEV_DEPLOY"; then
    log_pass "T05: 含 exit 非 0 错误处理"
  else
    log_fail "T05: 未找到 exit 非 0 的 migrate 失败处理"
  fi
fi

# T06: 含回滚指引（psql cecelia_dev < ...）
echo ""
echo "--- T06: 回滚指引 ---"
if [[ -f "$DEV_DEPLOY" ]]; then
  if grep -q "psql.*cecelia_dev" "$DEV_DEPLOY" || grep -q "回滚\|rollback" "$DEV_DEPLOY"; then
    log_pass "T06: 含回滚指引"
  else
    log_fail "T06: 缺少回滚指引（psql cecelia_dev < backup.sql）"
  fi
fi

# T07: dev-verify.sh 存在
echo ""
echo "--- T07: dev-verify.sh 存在性 ---"
if [[ -f "$DEV_VERIFY" ]]; then
  log_pass "T07: scripts/dev-verify.sh 存在"
else
  log_fail "T07: scripts/dev-verify.sh 不存在"
fi

# T08: dev-verify.sh 检查 5220 和 cecelia_dev
echo ""
echo "--- T08: dev-verify.sh 内容 ---"
if [[ -f "$DEV_VERIFY" ]]; then
  CHECKS_5220=$(grep -c "5220" "$DEV_VERIFY" 2>/dev/null || echo 0)
  CHECKS_DB=$(grep -c "cecelia_dev" "$DEV_VERIFY" 2>/dev/null || echo 0)
  if [[ "$CHECKS_5220" -ge 1 && "$CHECKS_DB" -ge 1 ]]; then
    log_pass "T08: dev-verify.sh 验证 5220 端口 + cecelia_dev DB"
  else
    log_fail "T08: dev-verify.sh 缺少 5220 端口检查（count=$CHECKS_5220）或 DB 检查（count=$CHECKS_DB）"
  fi
fi

# T09: 在线验证（可选，需 docker + pg 环境）
echo ""
echo "--- T09: 在线部署验证（可选）---"
if command -v docker &>/dev/null && command -v psql &>/dev/null 2>/dev/null; then
  echo "[INFO] 在线环境可用，如需验证请手动执行："
  echo "  bash $DEV_DEPLOY"
  echo "  curl -sf http://localhost:5220/api/brain/health"
  echo "  psql -U postgres -d cecelia_dev -c 'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;'"
else
  echo "[SKIP] T09: 在线验证需要 docker + psql 环境，跳过"
fi

echo ""
echo "============================================"
echo "FR-02 完成：PASS=$PASS  FAIL=$FAIL"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
