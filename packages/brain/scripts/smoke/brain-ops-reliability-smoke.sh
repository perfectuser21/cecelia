#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BASE_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0
FAIL=0

check() {
  local name="$1"
  shift
  if "$@" &>/dev/null; then
    echo "  ✅ $name"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name"
    FAIL=$((FAIL+1))
  fi
}

echo "=== brain-ops-reliability smoke ==="

# A. keepalive 脚本存在且可执行
check "brain-keepalive-check.sh 可执行" \
  test -x "$REPO_ROOT/scripts/ops/brain-keepalive-check.sh"

# A. plist 存在
check "com.cecelia.brain-keepalive.plist 存在" \
  test -f "$REPO_ROOT/scripts/ops/com.cecelia.brain-keepalive.plist"

# B. janitor API 可调用（要求 Brain 已运行）
check "janitor jobs API 包含 docker-prune" \
  bash -c "curl -sf '$BASE_URL/api/brain/janitor/jobs' | grep -q 'docker-prune'"

# C. account-usage.js 导出 selectBestAccount（静态检查，不连库）
check "account-usage.js 含 selectBestAccount export" \
  node -e "const c=require('fs').readFileSync('$REPO_ROOT/packages/brain/src/account-usage.js','utf8');if(!c.includes('export async function selectBestAccount'))process.exit(1)"

# D. executor.js 不含 minSessionHours harness 逻辑（OAuth 自动刷新，已删除错误限制）
check "executor.js 已移除 harness minSessionHours 限制" \
  node -e "const c=require('fs').readFileSync('$REPO_ROOT/packages/brain/src/executor.js','utf8');if(c.includes('minSessionHours'))process.exit(1)"

# E. harness-worktree.js H17 — 含 cloneSourceIsLocal 远端 URL 支持逻辑
check "harness-worktree.js 含 H17 cloneSourceIsLocal 远端 URL 支持" \
  node -e "const c=require('fs').readFileSync('$REPO_ROOT/packages/brain/src/harness-worktree.js','utf8');if(!c.includes('cloneSourceIsLocal'))process.exit(1)"

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
