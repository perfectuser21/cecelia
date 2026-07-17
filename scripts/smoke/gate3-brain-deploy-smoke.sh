#!/usr/bin/env bash
# gate3-brain-deploy-smoke.sh — Gate3 brain 部署假跳过回归守卫（bug e0f21d36 → becfd554）
#
# 守的病：deploy-local.sh 自算改动用三点 diff `git diff origin/main...HEAD`。
#   该脚本原设计给 /dev 在【领先 main 的 feature 分支】调用，diff 有内容；
#   但 Gate3 deploy webhook 在【部署根的 main 分支】上跑，HEAD 恒等于/落后 origin/main
#   → 三点 diff（merge-base→HEAD）恒为空 → NEED_BRAIN=false → 跳过真部署 → 生产跑旧代码。
#   squash merge 后必现，已多次实证（#4024 改 brain src 被判无改动，becfd554 修复）。
#
# 根治（v2，bug becfd554）：用 SHA 对账取代版本号对比——
#   origin/main HEAD SHA ≠ 生产 /health git_sha → 强制 NEED_BRAIN=true，与文件列表无关。
#   测试钩子 CECELIA_PROD_GIT_SHA 注入假生产 SHA，跳过真实 curl。
#
# 四段断言（真链路，不 mock；隔离 git repo + --dry-run 跳过真实 build/部署）：
#   A SHA 不等→部署    ：diff 空 + CECELIA_PROD_GIT_SHA 与 origin/main 不同 → 触发 brain 部署
#   B SHA 相等→跳过    ：diff 空 + CECELIA_PROD_GIT_SHA 与 origin/main 相同 → 跳过（幂等）
#   C 显式 --changed   ：传 --changed=packages/brain/... → 照常部署（SHA 对账不干扰正常路径）
#   D feature 分支 diff ：HEAD 领先 main（真有 brain 改动）→ 照常部署（三点 diff 正常路径不回归）
#
# 测试钩子：
#   CECELIA_PROD_GIT_SHA=<sha>  注入"生产运行 SHA"，跳过真实 curl /api/brain/health
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
  || fail "前提不成立：三点 diff 非空（${DIFF_ON_MAIN}），场景没复现对"
echo ""

run_deploy() { # $1=CECELIA_PROD_GIT_SHA(空则不注入)  $2..=额外参数
  local prod_sha="$1"; shift
  if [[ -n "$prod_sha" ]]; then
    (cd "$WORK" && CECELIA_DEPLOY_ROOT="$WORK" CECELIA_PROD_GIT_SHA="$prod_sha" \
      bash "$DEPLOY" --dry-run "$@" main 2>&1)
  else
    (cd "$WORK" && CECELIA_DEPLOY_ROOT="$WORK" \
      bash "$DEPLOY" --dry-run "$@" main 2>&1)
  fi
}

# ════════════════════════════════════════════════════════════════════════════
echo "[A] SHA 不等 → 部署（SHA 对账触发，不再假跳过）"
# 生产跑旧 SHA（aaabbb000000...）≠ origin/main HEAD → SHA_MISMATCH=true → 强制部署
OUT_A=$(run_deploy "aaabbb000000aaabbb000000aaabbb000000aaab")
if echo "$OUT_A" | grep -q "brain-deploy.sh\|Brain 部署\|brain-deploy"; then
  pass "diff 空但 SHA 不等 → 触发 brain 部署（假跳过已根治）"
else
  fail "diff 空 + SHA 不等仍跳过 brain 部署（SHA 对账未生效）"
  echo "$OUT_A" | sed 's/^/    /' | tail -12
fi
echo ""

# ════════════════════════════════════════════════════════════════════════════
echo "[B] SHA 相等 → 跳过（幂等，不无谓重部署）"
# 生产 SHA == origin/main HEAD → SHA 一致，无需重部署
ORIGIN_SHA_B=$(git -C "$WORK" rev-parse origin/main 2>/dev/null || echo "")
OUT_B=$(run_deploy "$ORIGIN_SHA_B")
if echo "$OUT_B" | grep -q "跳过\|一致"; then
  pass "diff 空且 SHA 相等 → 正确跳过（不重复部署同版本）"
else
  fail "SHA 相等却仍触发部署（SHA 对账过度，破坏幂等）"
  echo "$OUT_B" | sed 's/^/    /' | tail -12
fi
echo ""

# ════════════════════════════════════════════════════════════════════════════
echo "[C] 显式 --changed → 照常部署（SHA 对账不干扰文件列表正常路径）"
# SHA 相等，但 --changed 显式指定 brain 文件 → 文件列表范围加法触发
ORIGIN_SHA_C=$(git -C "$WORK" rev-parse origin/main 2>/dev/null || echo "")
OUT_C=$(run_deploy "$ORIGIN_SHA_C" --changed="packages/brain/src/server.js")
if echo "$OUT_C" | grep -q "brain-deploy.sh\|Brain 改动\|brain-deploy"; then
  pass "显式 --changed 指定 brain 文件 → 照常部署（即便 SHA 相等）"
else
  fail "显式 --changed 被 SHA 对账误跳过（文件列表范围加法失效）"
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
# HEAD(cp-feature) 领先 main → 三点 diff 有 brain 文件 → NEED_BRAIN=true
# CECELIA_PROD_GIT_SHA 设为 origin/main SHA（SHA 对账不叠加，验证文件列表路径独立工作）
ORIGIN_SHA_D=$(git -C "$WORK" rev-parse origin/main 2>/dev/null || echo "")
OUT_D=$(cd "$WORK" && CECELIA_DEPLOY_ROOT="$WORK" CECELIA_PROD_GIT_SHA="$ORIGIN_SHA_D" \
  bash "$DEPLOY" --dry-run main 2>&1)
if echo "$OUT_D" | grep -q "brain-deploy.sh\|Brain 改动\|brain-deploy"; then
  pass "feature 分支领先 main 时三点 diff 正常命中 brain（原路径未被破坏）"
else
  fail "feature 分支 brain 改动漏检（正常路径回归了）"
  echo "$OUT_D" | sed 's/^/    /' | tail -12
fi
echo ""

# ════════════════════════════════════════════════════════════════════════════
# E: FR-07 SHA 回读断言场景（Gate3 C-05）
# brain-deploy.sh --sha-check-only：HEALTH_JSON_OVERRIDE fixture 注入
# 场景 E1：SHA 不匹配 → exit 1（ROLLBACK）
# 场景 E2：SHA 一致  → exit 0
echo "[E] SHA 回读断言（--sha-check-only）"
BRAIN_DEPLOY="$ROOT_DIR/scripts/brain-deploy.sh"

if [[ ! -f "$BRAIN_DEPLOY" ]]; then
  fail "brain-deploy.sh 不存在：$BRAIN_DEPLOY"
else
  # E1: SHA 不匹配 → 应 exit 1（ROLLBACK）
  EXPECTED_SHA="abc1234abc1234abc1234abc1234abc1234abc12"
  WRONG_SHA="deadbeef00000000deadbeef00000000deadbeef"
  FIXTURE_E1="$TMP/health-wrong-sha.json"
  printf '{"ok":true,"version":"1.0.0","git_sha":"%s","uptime_seconds":5}' \
    "$WRONG_SHA" > "$FIXTURE_E1"

  E1_EXIT=0
  E1_OUT=$(HEALTH_JSON_OVERRIDE="$FIXTURE_E1" EXPECTED_SHA="$EXPECTED_SHA" \
    bash "$BRAIN_DEPLOY" --dry-run --sha-check-only 2>&1) || E1_EXIT=$?

  if [[ $E1_EXIT -ne 0 ]]; then
    pass "[E1] SHA 不匹配 → exit ${E1_EXIT}（ROLLBACK 触发）"
  else
    fail "[E1] SHA 不匹配时 exit 0（应 exit 1，ROLLBACK 未触发）"
    echo "$E1_OUT" | sed 's/^/    /' | head -10
  fi

  # E2: SHA 一致 → 应 exit 0
  FIXTURE_E2="$TMP/health-match-sha.json"
  printf '{"ok":true,"version":"1.0.0","git_sha":"%s","uptime_seconds":5}' \
    "$EXPECTED_SHA" > "$FIXTURE_E2"

  E2_EXIT=0
  E2_OUT=$(HEALTH_JSON_OVERRIDE="$FIXTURE_E2" EXPECTED_SHA="$EXPECTED_SHA" \
    bash "$BRAIN_DEPLOY" --dry-run --sha-check-only 2>&1) || E2_EXIT=$?

  if [[ $E2_EXIT -eq 0 ]]; then
    pass "[E2] SHA 一致 → exit 0（部署视为正确）"
  else
    fail "[E2] SHA 一致时 exit ${E2_EXIT}（应 exit 0）"
    echo "$E2_OUT" | sed 's/^/    /' | head -10
  fi
fi
echo ""

echo "========================================"
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}GATE3_BRAIN_DEPLOY_SMOKE_OK${NC} — 假跳过已根治，五段全绿（含 E SHA 回读）"
  exit 0
else
  echo -e "${RED}GATE3_BRAIN_DEPLOY_SMOKE_FAIL${NC} — ${FAILED} 项红"
  exit 1
fi
