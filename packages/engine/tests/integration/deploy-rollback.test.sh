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
# 本测试只验证 release/rollback 生命周期；frontend 重绑由
# release-deploy-stage.test.sh 的 fake docker 断言独立覆盖。
export CECELIA_SKIP_FRONTEND_RECREATE=1
DASH="$ROOT/apps/dashboard"
mkdir -p "$DASH" "$ROOT/scripts" "$ROOT/packages/brain/migrations"
( cd "$ROOT" && git init -q -b main && git config user.email t@t && git config user.name t )
# 隔离掉全局/继承的 core.hooksPath（否则本机 pre-commit 守护会拦 main 分支的测试内部提交）
( cd "$ROOT" && git config core.hooksPath /dev/null )
echo "seed" > "$ROOT/seed.txt"
( cd "$ROOT" && git add -A && git commit -q -m "seed" )

# ── brain 回档复用现有原语：seed .brain-versions 账本 + mock brain-rollback.sh ──────
# 收口设计（清单法）：promote 记当时 .brain-versions head 进 manifest；rollback 不再
# git checkout 重建，改调 brain-rollback.sh <镜像版本>。本测试用 mock brain-rollback.sh
# 记录被传的版本（断言走的是这条路径，不是 git checkout），不真起 docker。
BRAIN_RB_LOG="$ROOT/.brain-rollback-calls.log"
printf '1.230.15\n1.230.16\n1.230.17\n1.230.18\n' > "$ROOT/.brain-versions"
cat > "$ROOT/scripts/brain-rollback.sh" <<MOCK
#!/usr/bin/env bash
echo "brain-rollback called with: \$*" >> "$BRAIN_RB_LOG"
echo "\$1" > "$ROOT/.brain-rollback-last-version"
exit 0
MOCK
chmod +x "$ROOT/scripts/brain-rollback.sh"

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
    # SKIP_HK/SKIP_FINGERPRINT：CI ubuntu 无 hk-vps/无 5211，promote fatal 化后不跳必红
    CECELIA_DEPLOY_ROOT="$ROOT" CECELIA_SKIP_BRAIN_PROMOTE=1 \
        CECELIA_SKIP_HK=1 CECELIA_SKIP_FINGERPRINT=1 \
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

# ★ 清单法：promote 把当时 .brain-versions head（1.230.18）记进 v1 的 manifest 行
V1_MANIFEST=$(grep "^manifest=prod-cecelia-v1 " "$ROOT/.production-release" 2>/dev/null | head -1)
if [[ -n "$V1_MANIFEST" && "$V1_MANIFEST" == *"brain_image=1.230.18"* ]]; then
    pass "★ promote v1 manifest 记了 brain_image=1.230.18（.brain-versions head）"
else
    fail "★ promote v1 manifest 缺 brain_image=1.230.18，实际: $V1_MANIFEST"
fi

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
    fail "★ 回档后 current=${NOW_TAG}，应为 prod-cecelia-v1"
fi

# ── rollback 带不存在的 tag → 报错退出（不猜）─────────────────────────────────
if CECELIA_DEPLOY_ROOT="$ROOT" CECELIA_SKIP_BRAIN_PROMOTE=1 bash "$ROLLBACK" prod-cecelia-v999 >/dev/null 2>&1; then
    fail "rollback 带不存在 tag 应报错退出，却退出 0"
else
    pass "rollback 带不存在 tag → 报错退出（不在留存内不猜）"
fi

# ── ★ brain 子步复用 brain-rollback.sh（不再 git checkout 重建）──────────────────
# 不带 CECELIA_SKIP_BRAIN_PROMOTE，让 brain 子步真跑（走 mock brain-rollback.sh）。
# 当前 current=v1（上一步回档后）。回档到 v1 时 brain 子步应调 brain-rollback.sh，
# 传 v1 manifest 里记的 brain_image=1.230.18，且不出现 git checkout。
rm -f "$BRAIN_RB_LOG" "$ROOT/.brain-rollback-last-version"
ROLLBACK_OUT=$(CECELIA_DEPLOY_ROOT="$ROOT" bash "$ROLLBACK" prod-cecelia-v1 2>&1)
if [[ -f "$ROOT/.brain-rollback-last-version" ]]; then
    pass "★ rollback brain 子步调用了 brain-rollback.sh（复用现有原语，非 git checkout）"
else
    fail "★ rollback brain 子步没调 brain-rollback.sh（可能还在 git checkout 重建）"
fi
if [[ "$(cat "$ROOT/.brain-rollback-last-version" 2>/dev/null)" == "1.230.18" ]]; then
    pass "★ brain-rollback.sh 收到正确镜像版本 1.230.18（来自 v1 manifest）"
else
    fail "★ brain-rollback.sh 收到的版本错: $(cat "$ROOT/.brain-rollback-last-version" 2>/dev/null)"
fi
if ! echo "$ROLLBACK_OUT" | grep -q "git checkout"; then
    pass "★ rollback 输出不含 git checkout（平行路径已拆除）"
else
    fail "★ rollback 仍在 git checkout 重建 brain：$(echo "$ROLLBACK_OUT" | grep 'git checkout' | head -1)"
fi

# ── ★ 目标 vN 的 brain_image 已被 .brain-versions prune → 报错退出（不偷偷重建）────
# 把账本改成不含 1.230.18（模拟该镜像版本被 prune 出账本），回档 v1 应报错退出。
printf '1.230.20\n1.230.21\n' > "$ROOT/.brain-versions"
rm -f "$ROOT/.brain-rollback-last-version"
if CECELIA_DEPLOY_ROOT="$ROOT" bash "$ROLLBACK" prod-cecelia-v1 >/dev/null 2>&1; then
    fail "★ 目标镜像版本不在 .brain-versions 应报错退出，却退出 0"
else
    pass "★ 目标 brain 镜像版本被 prune 出账本 → 报错退出（不偷偷 git 重建）"
fi
# 恢复账本供后续测试
printf '1.230.15\n1.230.16\n1.230.17\n1.230.18\n' > "$ROOT/.brain-versions"
# 复位 current 回 v1（上面失败的回档不应改指针；保险起见显式确认）
NOW_AFTER=$(grep '^current=' "$ROOT/.production-release" | head -1 | cut -d= -f2)
if [[ "$NOW_AFTER" == "prod-cecelia-v1" ]]; then
    pass "镜像缺失报错退出后，指针未被改动（仍 current=prod-cecelia-v1）"
else
    fail "镜像缺失报错退出却动了指针：current=$NOW_AFTER"
fi

# ── 留存上限 5 份（独立 fresh 根，连续 8 次 promote 确定性验证删最旧）─────────────
R2=$(mktemp -d)
D2="$R2/apps/dashboard"
mkdir -p "$D2" "$R2/packages/brain/migrations"
( cd "$R2" && git init -q -b main && git config user.email t@t && git config user.name t && git config core.hooksPath /dev/null )
echo "s" > "$R2/seed.txt"
( cd "$R2" && git add -A && git commit -q -m "s" )
for i in 1 2 3 4 5 6 7 8; do
    echo "v$i" > "$R2/seed.txt"
    ( cd "$R2" && git add -A && git commit -q -m "v$i" )
    rm -rf "$D2/.dist-staging"; mkdir -p "$D2/.dist-staging"
    echo "V$i" > "$D2/.dist-staging/index.html"
    { echo "staging_dist=$D2/.dist-staging"; echo "staging_port=5223"; echo "commit=t"; } > "$D2/.staging-pending"
    CECELIA_DEPLOY_ROOT="$R2" CECELIA_SKIP_BRAIN_PROMOTE=1 \
        CECELIA_SKIP_HK=1 CECELIA_SKIP_FINGERPRINT=1 bash "$PROMOTE" >/dev/null 2>&1
done
# 8 次 promote → 留存的是被换下的旧版 v1..v7（共 7 个），按 5 份上限删到最近 5（v3..v7）。
RETAINED=$(ls -1 "$D2/.dist-releases/" 2>/dev/null | grep -c '^prod-cecelia-v')
if [[ "$RETAINED" -eq 5 ]]; then
    pass "留存份数 == 5（上限生效，实际 ${RETAINED}）"
else
    fail "留存份数 ${RETAINED} != 5，上限未正确生效"
fi
if [[ ! -d "$D2/.dist-releases/prod-cecelia-v1" && ! -d "$D2/.dist-releases/prod-cecelia-v2" ]]; then
    pass "最旧 v1/v2 已被清出留存（按 tag 序删最旧）"
else
    fail "最旧 v1/v2 仍在留存，未清旧：$(ls "$D2/.dist-releases/" | tr '\n' ' ')"
fi
rm -rf "$R2"

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
