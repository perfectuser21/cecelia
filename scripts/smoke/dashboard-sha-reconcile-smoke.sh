#!/usr/bin/env bash
# dashboard-sha-reconcile-smoke.sh — deploy-local.sh dashboard 判变"生产自报 SHA 对账"回归守卫
#
# 病根（2026-07-18，issue 89079934）：专用部署根 reset --hard origin/main 后
# git diff origin/main...HEAD 恒空 → dashboard 改动永远判"无改动"静默跳过（#4022/#4038 实证）。
# 本 smoke 用 CECELIA_PROD_DASHBOARD_SHA 注入"生产落后"场景，断言判变触发 Dashboard 构建。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY="$REPO_ROOT/scripts/deploy-local.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
pass(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
fail(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# 隔离 fixture 仓：commit1 = base，commit2 只改 apps/dashboard/x.txt。
# 不配 origin —— deploy-local 的 ref 解析须回退本地 main（Brain 对账因 ORIGIN_SHA 空自动跳过）。
# core.hooksPath=/dev/null：屏蔽用户全局 hooks（否则 pre-commit 拦 main 分支 commit，fixture 搭不起来）。
new_fixture() {
  local R="$TMP/repo-$RANDOM"
  mkdir -p "$R"
  git -C "$R" init -q -b main
  git -C "$R" -c core.hooksPath=/dev/null -c user.email=t@t.t -c user.name=t commit -q --allow-empty -m base
  mkdir -p "$R/apps/dashboard"
  echo x > "$R/apps/dashboard/x.txt"
  git -C "$R" add -A
  git -C "$R" -c core.hooksPath=/dev/null -c user.email=t@t.t -c user.name=t commit -q -m "dash change"
  echo "$R"
}

R=$(new_fixture)
C1=$(git -C "$R" rev-parse HEAD~1)
C2=$(git -C "$R" rev-parse HEAD)

echo "[1] 生产 sha 落后且改动在 apps/dashboard → 必须触发 Dashboard 构建"
OUT=$(cd "$R" && CECELIA_DEPLOY_ROOT="$R" CECELIA_PROD_DASHBOARD_SHA="$C1" bash "$DEPLOY" --dry-run 2>&1) || true
if echo "$OUT" | grep -q "Dashboard 改动"; then
  pass "判变触发 Dashboard 构建"
else
  fail "未触发 Dashboard 构建（静默跳过复发）"
  echo "$OUT" | sed 's/^/    | /'
fi

echo "[2] 生产 sha == HEAD → 不触发（防误报）"
OUT=$(cd "$R" && CECELIA_DEPLOY_ROOT="$R" CECELIA_PROD_DASHBOARD_SHA="$C2" bash "$DEPLOY" --dry-run 2>&1) || true
if echo "$OUT" | grep -q "Dashboard 改动"; then
  fail "sha 一致仍触发（误报）"
  echo "$OUT" | sed 's/^/    | /'
else
  pass "sha 一致正确跳过"
fi

echo ""
echo "dashboard-sha-reconcile-smoke: PASS=$PASS FAIL=$FAIL"
[[ $FAIL -eq 0 ]]
