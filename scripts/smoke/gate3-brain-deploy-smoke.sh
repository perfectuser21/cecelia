#!/usr/bin/env bash
# gate3-brain-deploy-smoke.sh — Gate3 brain 部署假跳过回归守卫（bug e0f21d36）
#
# 守的病：deploy-local.sh 自算改动用三点 diff `git diff origin/main...HEAD`。
#   该脚本原设计给 /dev 在【领先 main 的 feature 分支】调用，diff 有内容；
#   但 Gate3 deploy webhook 在【部署根的 main 分支】上跑，HEAD 恒等于/落后 origin/main
#   → 三点 diff（merge-base→HEAD）恒为空 → NEED_BRAIN=false → 跳过真部署 → 生产跑旧代码。
#   squash merge 后必现，已三连发（07-15 立案）。
#
# 根治：git diff 判空时，用「brain 版本对比」兜底——
#   repo 的 packages/brain/package.json version ≠ 生产运行版本 → 强制走 brain 部署路径。
#
# 四段断言（真链路，不 mock；隔离 git repo + --dry-run 跳过真实 build/部署）：
#   A 版本不一致→部署  ：diff 空 + 生产版本旧 → 输出含 brain-deploy.sh（兜底触发，不再假跳过）
#   B 版本一致→跳过    ：diff 空 + 生产版本同 → 输出"跳过"（幂等，不无谓重部署）
#   C 显式 --changed   ：传 --changed=packages/brain/... → 照常部署（版本对比不干扰正常路径）
#   D feature 分支 diff ：HEAD 领先 main（真有 brain 改动）→ 照常部署（三点 diff 正常路径不回归）
#
# 测试钩子（实现侧需支持）：
#   CECELIA_DEPLOYED_BRAIN_VERSION=<v>  注入"生产运行版本"，跳过真实 curl /api/brain/version
#
# 用法： bash scripts/smoke/gate3-brain-deploy-smoke.sh
# 退出码： 0=全绿  1=有红

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY="$ROOT_DIR/scripts/deploy-local.sh"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILED=0
pass() { echo -e "${GREEN}[OK]${NC} $1"; }
fail() { echo -e "${RED}[X]${NC} $1"; FAILED=$((FAILED + 1)); }

TMP="$(mktemp -d -t gate3-brain-smoke.XXXXXX)"
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

echo "=== Gate3 brain 部署假跳过 smoke ==="
echo ""

[[ -f "$DEPLOY" ]] && pass "deploy-local.sh 存在" || { fail "deploy-local.sh 不存在"; exit 1; }

# ── 造隔离 repo：部署根在 main 分支、HEAD == origin/main（三点 diff 恒空）──────────
WORK="$TMP/repo"
ORIGIN="$TMP/origin.git"
git init -q --bare "$ORIGIN"
git init -q -b main "$WORK"
(
  cd "$WORK" || exit 1
  # 隔离 repo 禁用继承的全局 hooks（否则主仓库 branch-protect pre-commit 会拦 commit）
  git config core.hooksPath /dev/null
  git config user.email smoke@test.local
  git config user.name smoke
  mkdir -p packages/brain/src
  echo '{"name":"@cecelia/brain","version":"9.9.9"}' > packages/brain/package.json
  echo "// brain server" > packages/brain/src/server.js
  git add -A
  git commit -qm "init brain 9.9.9"
  git remote add origin "$ORIGIN"
  git push -q origin main
)
# 现在 HEAD == origin/main → deploy-local.sh 自算的三点 diff 为空（复现假跳过前提）
DIFF_ON_MAIN=$(cd "$WORK" && git diff --name-only origin/main...HEAD 2>/dev/null || echo "")
[[ -z "$DIFF_ON_MAIN" ]] \
  && pass "前提成立：部署根 main 上三点 diff 为空（假跳过触发条件）" \
  || fail "前提不成立：三点 diff 非空（$DIFF_ON_MAIN），场景没复现对"
echo ""

run_deploy() { # $1=env版本(空则不注入)  $2..=额外参数
  local ver="$1"; shift
  if [[ -n "$ver" ]]; then
    (cd "$WORK" && CECELIA_DEPLOY_ROOT="$WORK" CECELIA_DEPLOYED_BRAIN_VERSION="$ver" \
      bash "$DEPLOY" --dry-run "$@" main 2>&1)
  else
    (cd "$WORK" && CECELIA_DEPLOY_ROOT="$WORK" \
      bash "$DEPLOY" --dry-run "$@" main 2>&1)
  fi
}

# ════════════════════════════════════════════════════════════════════════════
echo "[A] 版本不一致 → 部署（兜底触发，不再假跳过）"
OUT_A=$(run_deploy "1.0.0")   # 生产 1.0.0 ≠ repo 9.9.9
if echo "$OUT_A" | grep -q "brain-deploy.sh"; then
  pass "diff 空但 brain 版本不一致 → 触发 brain 部署（假跳过已根治）"
else
  fail "diff 空 + 版本不一致仍跳过 brain 部署（假跳过未修）"
  echo "$OUT_A" | sed 's/^/    /' | tail -12
fi
echo ""

# ════════════════════════════════════════════════════════════════════════════
echo "[B] 版本一致 → 跳过（幂等，不无谓重部署）"
OUT_B=$(run_deploy "9.9.9")   # 生产 9.9.9 == repo 9.9.9
if echo "$OUT_B" | grep -q "跳过"; then
  pass "diff 空且版本一致 → 正确跳过（不重复部署同版本）"
else
  fail "版本一致却仍触发部署（兜底过度，破坏幂等）"
  echo "$OUT_B" | sed 's/^/    /' | tail -12
fi
echo ""

# ════════════════════════════════════════════════════════════════════════════
echo "[C] 显式 --changed → 照常部署（版本对比不干扰正常路径）"
OUT_C=$(run_deploy "9.9.9" --changed="packages/brain/src/server.js")
if echo "$OUT_C" | grep -q "brain-deploy.sh"; then
  pass "显式 --changed 指定 brain 文件 → 照常部署（即便版本一致）"
else
  fail "显式 --changed 被版本对比误跳过"
  echo "$OUT_C" | sed 's/^/    /' | tail -12
fi
echo ""

# ════════════════════════════════════════════════════════════════════════════
echo "[D] feature 分支 diff 非空 → 照常部署（三点 diff 正常路径不回归）"
(
  cd "$WORK" || exit 1
  git checkout -q -b cp-feature
  echo "// changed" >> packages/brain/src/server.js
  git commit -qam "brain change on feature"
)
OUT_D=$(cd "$WORK" && CECELIA_DEPLOY_ROOT="$WORK" CECELIA_DEPLOYED_BRAIN_VERSION="9.9.9" \
  bash "$DEPLOY" --dry-run main 2>&1)   # HEAD(cp-feature) 领先 main → 三点 diff 有 brain 文件
if echo "$OUT_D" | grep -q "brain-deploy.sh"; then
  pass "feature 分支领先 main 时三点 diff 正常命中 brain（原路径未被破坏）"
else
  fail "feature 分支 brain 改动漏检（正常路径回归了）"
  echo "$OUT_D" | sed 's/^/    /' | tail -12
fi
echo ""

echo "========================================"
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}GATE3_BRAIN_DEPLOY_SMOKE_OK${NC} — 假跳过已根治，四段全绿"
  exit 0
else
  echo -e "${RED}GATE3_BRAIN_DEPLOY_SMOKE_FAIL${NC} — ${FAILED} 项红"
  exit 1
fi
