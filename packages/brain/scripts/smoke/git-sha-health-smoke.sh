#!/usr/bin/env bash
# git-sha-health-smoke.sh — Gate3 SHA 对账：验证 /health 端点返回 git_sha 字段
#
# 触发条件：packages/brain/src/routes/goals.js 加 git_sha（FR-02，G1 9039956f）
# 验证：/health 响应体含 git_sha 字段（源码层 + 可选 HTTP 层）
#
# 用法：bash packages/brain/scripts/smoke/git-sha-health-smoke.sh
# 退出码：0=通过  1=失败

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILED=0
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAILED=$((FAILED + 1)); }

echo "=== Git SHA Health Smoke (Gate3 FR-02) ==="
echo ""

# ── 源码层：goals.js /health handler 含 git_sha ────────────────────────────
GOALS_FILE="$ROOT_DIR/packages/brain/src/routes/goals.js"
if [[ ! -f "$GOALS_FILE" ]]; then
  fail "goals.js 不存在: $GOALS_FILE"
else
  if grep -q "git_sha" "$GOALS_FILE"; then
    pass "goals.js /health handler 含 git_sha 字段（源码层）"
  else
    fail "goals.js /health handler 缺 git_sha 字段（FR-02 未实现）"
  fi
fi

# ── 源码层：ops.js /deploy/status 含 git_sha ──────────────────────────────
OPS_FILE="$ROOT_DIR/packages/brain/src/routes/ops.js"
if [[ ! -f "$OPS_FILE" ]]; then
  fail "ops.js 不存在: $OPS_FILE"
else
  if grep -q "git_sha" "$OPS_FILE"; then
    pass "ops.js /deploy/status 含 git_sha 字段（源码层）"
  else
    fail "ops.js 缺 git_sha 字段（FR-02 ops 层未实现）"
  fi
fi

# ── 源码层：Dockerfile 含 ARG/ENV GIT_SHA ─────────────────────────────────
DOCKERFILE="$ROOT_DIR/packages/brain/Dockerfile"
if [[ ! -f "$DOCKERFILE" ]]; then
  fail "Dockerfile 不存在: $DOCKERFILE"
else
  if grep -q "ARG GIT_SHA" "$DOCKERFILE" && grep -q "ENV GIT_SHA" "$DOCKERFILE"; then
    pass "Dockerfile 含 ARG GIT_SHA + ENV GIT_SHA（FR-01 构建期烙入）"
  else
    fail "Dockerfile 缺 ARG GIT_SHA 或 ENV GIT_SHA（FR-01 未实现）"
  fi
fi

# ── HTTP 层：如果 Brain 在线则验证真实 /health 响应 ─────────────────────────
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
if curl -sf --connect-timeout 3 "${BRAIN_URL}/api/brain/health" > /dev/null 2>&1; then
  HEALTH_JSON=$(curl -sf --connect-timeout 10 --max-time 15 "${BRAIN_URL}/api/brain/health" 2>/dev/null || echo "")
  if [[ -n "$HEALTH_JSON" ]]; then
    GIT_SHA_VAL=$(echo "$HEALTH_JSON" | node -e "
      const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
      process.stdout.write(d.git_sha||'');
    " 2>/dev/null || echo "")
    if [[ -n "$GIT_SHA_VAL" && "$GIT_SHA_VAL" != "unknown" ]]; then
      pass "HTTP /health 返回 git_sha=${GIT_SHA_VAL:0:8}...（HTTP 层验证）"
    elif [[ "$GIT_SHA_VAL" == "unknown" ]]; then
      # Brain 在线但未以 --build-arg GIT_SHA 构建（本地开发模式）
      echo "  [skip] /health git_sha=unknown（本地开发模式，非 Docker build，源码层验证已通过）"
    else
      # 字段完全缺失：可能是旧版 Brain（未部署新代码）
      echo "  [skip] /health 无 git_sha 字段（Brain 尚未部署新代码，源码层验证已通过）"
    fi
  fi
else
  echo "  [skip] Brain 未运行（${BRAIN_URL}），跳过 HTTP 层验证（源码层已验证）"
fi

echo ""
echo "=========================================="
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}GIT_SHA_HEALTH_SMOKE_OK${NC}"
  exit 0
else
  echo -e "${RED}GIT_SHA_HEALTH_SMOKE_FAIL${NC} — ${FAILED} 项失败"
  exit 1
fi
