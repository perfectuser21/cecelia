#!/usr/bin/env bash
# deploy-rollback.test.sh — 部署生命周期 阶段1 回档 E2E
#
# 验证共享契约（spec §1）在 cecelia 落地：
#   promote v1 → promote v2 → rollback-cecelia.sh → live dist/ 回到 v1 + 指针回拨。
# 用 CECELIA_DEPLOY_ROOT 测试钩子在隔离临时目录自洽跑，绝不碰真生产 / 真 HK。

set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PROMOTE="$REPO_ROOT/scripts/promote-dashboard.sh"
ROLLBACK="$REPO_ROOT/scripts/rollback-cecelia.sh"

[[ -f "$PROMOTE" ]]  || { echo "缺 $PROMOTE"; exit 1; }
[[ -f "$ROLLBACK" ]] || { echo "缺 $ROLLBACK"; exit 1; }

# ── 隔离部署根（init 成真 git repo，让 brain checkout 钩子有可切的 ref）──────────
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
DASH="$ROOT/apps/dashboard"
mkdir -p "$DASH" "$ROOT/scripts" "$ROOT/packages/brain/migrations"
( cd "$ROOT" && git init -q -b main && git config user.email t@t && git config user.name t )
echo "seed" > "$ROOT/seed.txt"
( cd "$ROOT" && git add -A && git commit -q -m "seed" )

# 造待放行 staging 产物 + 放行标记（模拟 deploy-local.sh 的产出）
stage_version() {
    local content="$1"
    rm -rf "$DASH/.dist-staging"
    mkdir -p "$DASH/.dist-staging"
    echo "$content" > "$DASH/.dist-staging/index.html"
    {
        echo "staging_dist=$DASH/.dist-staging"
        echo "staging_port=5223"
        echo "commit=testcommit"
    } > "$DASH/.staging-pending"
}

run_promote() {
    CECELIA_DEPLOY_ROOT="$ROOT" CECELIA_SKIP_BRAIN_PROMOTE=1 \
        bash "$PROMOTE" >/dev/null 2>&1
}

# ── promote v1 ────────────────────────────────────────────────────────────────
stage_version "VERSION-1"
if run_promote; then pass "promote v1 退出 0"; else fail "promote v1 退出非 0"; fi

V1_TAG=$(grep '^current=' "$ROOT/.production-release" 2>/dev/null | head -1 | cut -d= -f2)
if [[ -f "$ROOT/.production-release" ]]; then pass "promote v1 写了 .production-release"; else fail "无 .production-release"; fi
if [[ "$V1_TAG" == "prod-cecelia-v1" ]]; then pass "v1 tag = prod-cecelia-v1"; else fail "v1 tag 错: $V1_TAG"; fi
if [[ "$(cat "$DASH/dist/index.html" 2>/dev/null)" == "VERSION-1" ]]; then pass "live dist = v1"; else fail "live dist 不是 v1"; fi
if git -C "$ROOT" rev-parse "prod-cecelia-v1" >/dev/null 2>&1; then pass "git tag prod-cecelia-v1 已打"; else fail "git tag prod-cecelia-v1 缺失"; fi

# ── promote v2 ────────────────────────────────────────────────────────────────
echo "v2" > "$ROOT/seed.txt"
( cd "$ROOT" && git add -A && git commit -q -m "v2" )
stage_version "VERSION-2"
if run_promote; then pass "promote v2 退出 0"; else fail "promote v2 退出非 0"; fi

V2_TAG=$(grep '^current=' "$ROOT/.production-release" | head -1 | cut -d= -f2)
if [[ "$V2_TAG" == "prod-cecelia-v2" ]]; then pass "v2 tag = prod-cecelia-v2（单调递增）"; else fail "v2 tag 错: $V2_TAG"; fi
if [[ "$(cat "$DASH/dist/index.html")" == "VERSION-2" ]]; then pass "live dist = v2"; else fail "live dist 不是 v2"; fi
if [[ "$(cat "$DASH/.dist-releases/prod-cecelia-v1/index.html" 2>/dev/null)" == "VERSION-1" ]]; then
    pass "v1 旧产物留存在 .dist-releases/prod-cecelia-v1/（不删）"
else
    fail "v1 旧产物未留存"
fi

# ── rollback（无参 → 退到上一个 tag = v1）─────────────────────────────────────
if CECELIA_DEPLOY_ROOT="$ROOT" CECELIA_SKIP_BRAIN_PROMOTE=1 bash "$ROLLBACK" >/dev/null 2>&1; then
    pass "rollback-cecelia.sh 退出 0"
else
    fail "rollback-cecelia.sh 退出非 0"
fi

# ★ 核心断言：live dist/ 回到 v1
if [[ "$(cat "$DASH/dist/index.html")" == "VERSION-1" ]]; then
    pass "★ 回档后 live dist/ 内容回到 v1"
else
    fail "★ 回档后 live dist/ 仍是 $(cat "$DASH/dist/index.html")，应为 VERSION-1"
fi

# ★ 核心断言：指针 current 回拨到 v1 tag
NOW_TAG=$(grep '^current=' "$ROOT/.production-release" | head -1 | cut -d= -f2)
if [[ "$NOW_TAG" == "prod-cecelia-v1" ]]; then
    pass "★ 回档后 .production-release current 回到 prod-cecelia-v1"
else
    fail "★ 回档后 current=$NOW_TAG，应为 prod-cecelia-v1"
fi

# ── rollback 带不存在的 tag → 报错退出（不猜）─────────────────────────────────
if CECELIA_DEPLOY_ROOT="$ROOT" CECELIA_SKIP_BRAIN_PROMOTE=1 bash "$ROLLBACK" prod-cecelia-v999 >/dev/null 2>&1; then
    fail "rollback 带不存在 tag 应报错退出，却退出 0"
else
    pass "rollback 带不存在 tag → 报错退出（不在留存内不猜）"
fi

# ── 留存上限 5 份 ─────────────────────────────────────────────────────────────
# 当前已有 v1,v2（回档后 current=v1）。再 promote v3..v7 共制造 7 个版本。
for i in 3 4 5 6 7; do
    echo "v$i" > "$ROOT/seed.txt"
    ( cd "$ROOT" && git add -A && git commit -q -m "v$i" )
    stage_version "VERSION-$i"
    run_promote
done
RETAINED=$(ls -1 "$DASH/.dist-releases/" 2>/dev/null | wc -l | tr -d ' ')
if [[ "$RETAINED" -le 5 ]]; then
    pass "留存份数 ≤ 5（实际 $RETAINED，按 tag 序删最旧）"
else
    fail "留存份数 $RETAINED > 5，未清旧"
fi
if [[ ! -d "$DASH/.dist-releases/prod-cecelia-v1" ]]; then
    pass "最旧 prod-cecelia-v1 已被清出留存（超 5 份）"
else
    fail "最旧 prod-cecelia-v1 仍在留存，未清旧"
fi

# ── brain 回档遇 migration 变动 → 需 --confirm-db ─────────────────────────────
# 制造一个"无 migration 改动"的 guard 版本，再加 migration 提交并 promote 新版；
# 回档到 guard 版（migration 之前）应被 --confirm-db 拦。
echo "guard" > "$ROOT/seed.txt"
( cd "$ROOT" && git add -A && git commit -q -m "guard" )
stage_version "VERSION-GUARD"
run_promote
GUARD_TAG=$(grep '^current=' "$ROOT/.production-release" | head -1 | cut -d= -f2)

echo "ALTER TABLE x;" > "$ROOT/packages/brain/migrations/999_test_mig.sql"
( cd "$ROOT" && git add -A && git commit -q -m "add migration" )
stage_version "VERSION-AFTER-MIG"
run_promote

if CECELIA_DEPLOY_ROOT="$ROOT" CECELIA_SKIP_BRAIN_PROMOTE=1 bash "$ROLLBACK" "$GUARD_TAG" >/dev/null 2>&1; then
    fail "回档跨 migration 应被拦（缺 --confirm-db），却退出 0"
else
    pass "回档跨 migration 被拦截，要求 --confirm-db"
fi
if CECELIA_DEPLOY_ROOT="$ROOT" CECELIA_SKIP_BRAIN_PROMOTE=1 bash "$ROLLBACK" "$GUARD_TAG" --confirm-db >/dev/null 2>&1; then
    pass "回档跨 migration 带 --confirm-db 后放行"
else
    fail "带 --confirm-db 仍被拦"
fi

echo ""
echo "=== deploy-rollback: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
