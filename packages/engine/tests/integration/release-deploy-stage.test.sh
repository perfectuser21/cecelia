#!/usr/bin/env bash
# release-deploy-stage.test.sh — promote-dashboard.sh 三模式回归（staging → release → deploy）。
#
# 守死：--release-only 冻结产物进库 + 打 tag + 写 manifest，但【不动 live、不动 current】；
#       --deploy <tag> 从产物库换入 live + 写 current；--deploy <不存在> 报错不动生产；
#       两步(release-only → deploy) 末态 == 无参(full)。
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
PROMOTE="$REPO_ROOT/scripts/promote-dashboard.sh"
[[ -f "$PROMOTE" ]] || { echo "缺 $PROMOTE"; exit 1; }

new_root() {
    local R; R=$(mktemp -d)
    local D="$R/apps/dashboard"; mkdir -p "$D" "$R/scripts"
    ( cd "$R" && git init -q -b main && git config user.email t@t && git config user.name t \
        && git config core.hooksPath /dev/null && echo seed > seed.txt && git add -A && git commit -q -m seed )
    printf '1.230.18\n' > "$R/.brain-versions"
    echo "$R"
}
stage() {  # <root> <content>
    local R="$1" C="$2" D="$1/apps/dashboard"
    rm -rf "$D/.dist-staging"; mkdir -p "$D/.dist-staging"; echo "$C" > "$D/.dist-staging/index.html"
    { echo "staging_dist=$D/.dist-staging"; echo "staging_port=5223"; echo "commit=testcommit"; } > "$D/.staging-pending"
}
run() {  # <root> args...
    local R="$1"; shift
    CECELIA_DEPLOY_ROOT="$R" CECELIA_SKIP_BRAIN_PROMOTE=1 CECELIA_SKIP_FRONTEND_RECREATE=1 CECELIA_SKIP_HK=1 CECELIA_SKIP_FINGERPRINT=1 \
        bash "$PROMOTE" "$@" >/dev/null 2>&1
}

# ── 1) --release-only：冻结+tag+manifest，不动 live/current ────────────────────
R=$(new_root); D="$R/apps/dashboard"
stage "$R" "REL-1"
if run "$R" --release-only; then pass "--release-only 退出 0"; else fail "--release-only 退出非 0"; fi
if [[ "$(cat "$D/.dist-releases/prod-cecelia-v1/index.html" 2>/dev/null)" == "REL-1" ]]; then
    pass "release 冻结产物进 .dist-releases/prod-cecelia-v1"; else fail "release 未冻结产物进库"; fi
if git -C "$R" rev-parse "prod-cecelia-v1" >/dev/null 2>&1; then pass "release 打了 git tag prod-cecelia-v1"; else fail "release 未打 git tag"; fi
if grep -q "^manifest=prod-cecelia-v1 " "$R/.production-release" 2>/dev/null; then pass "release 写了 manifest"; else fail "release 未写 manifest"; fi
if [[ ! -d "$D/dist" ]]; then pass "★ release 不动 live dist/（未部署）"; else fail "★ release 误动了 live dist/"; fi
if ! grep -q "^current=" "$R/.production-release" 2>/dev/null; then pass "★ release 不写 current（还没部署）"; else fail "★ release 误写了 current"; fi
rm -rf "$R"

# ── 2) --deploy <tag>：从库换入 live + 写 current ──────────────────────────────
R=$(new_root); D="$R/apps/dashboard"
stage "$R" "DEP-1"
run "$R" --release-only
if run "$R" --deploy prod-cecelia-v1; then pass "--deploy <tag> 退出 0"; else fail "--deploy <tag> 退出非 0"; fi
if [[ "$(cat "$D/dist/index.html" 2>/dev/null)" == "DEP-1" ]]; then pass "deploy 把库版本换入 live dist/"; else fail "deploy 未换入 live"; fi
if [[ "$(grep '^current=' "$R/.production-release" | head -1 | cut -d= -f2)" == "prod-cecelia-v1" ]]; then
    pass "deploy 写了 current=prod-cecelia-v1"; else fail "deploy 未写 current"; fi
rm -rf "$R"

# ── 3) --deploy <不存在 tag>：报错退，不动生产（不猜）─────────────────────────
R=$(new_root); D="$R/apps/dashboard"
mkdir -p "$D/dist"; echo "LIVE-OLD" > "$D/dist/index.html"
if run "$R" --deploy prod-cecelia-v999; then fail "★ --deploy 不存在 tag 竟退出 0"; else pass "★ --deploy 不存在 tag 报错退出"; fi
if [[ "$(cat "$D/dist/index.html" 2>/dev/null)" == "LIVE-OLD" ]]; then pass "★ 部署源缺失时 live dist/ 未被动"; else fail "★ 部署源缺失却动了 live"; fi
rm -rf "$R"

# ── 4) 两步(release-only→deploy) 末态 == 无参(full) ───────────────────────────
RA=$(new_root); DA="$RA/apps/dashboard"; stage "$RA" "SAME"; run "$RA" --release-only; run "$RA" --deploy prod-cecelia-v1
RB=$(new_root); DB="$RB/apps/dashboard"; stage "$RB" "SAME"; run "$RB"   # 无参=full
A_CUR=$(grep '^current=' "$RA/.production-release" | head -1 | cut -d= -f2)
B_CUR=$(grep '^current=' "$RB/.production-release" | head -1 | cut -d= -f2)
A_LIVE=$(cat "$DA/dist/index.html" 2>/dev/null); B_LIVE=$(cat "$DB/dist/index.html" 2>/dev/null)
if [[ "$A_CUR" == "$B_CUR" && "$A_LIVE" == "$B_LIVE" && "$A_LIVE" == "SAME" ]]; then
    pass "★ 两步 == 无参(full) 末态一致 current=${A_CUR} live=${A_LIVE}"; else fail "★ 两步与 full 末态不一致: A(cur=${A_CUR} live=${A_LIVE}) B(cur=${B_CUR} live=${B_LIVE})"; fi
rm -rf "$RA" "$RB"

# ── 5) frontend 重绑：只重建 frontend，不连带 Brain ─────────────────────────
R=$(new_root); D="$R/apps/dashboard"; stage "$R" "REBIND"
mkdir -p "$R/fakebin"
printf '%s\n' '#!/bin/sh' 'printf "%s\\n" "$*" >> "$DOCKER_LOG"' > "$R/fakebin/docker"
chmod +x "$R/fakebin/docker"
run "$R" --release-only
if PATH="$R/fakebin:$PATH" DOCKER_LOG="$R/docker.log" CECELIA_DEPLOY_ROOT="$R" \
    CECELIA_SKIP_BRAIN_PROMOTE=1 CECELIA_SKIP_HK=1 CECELIA_SKIP_FINGERPRINT=1 \
    bash "$PROMOTE" --deploy prod-cecelia-v1 >/dev/null 2>&1; then
    pass "frontend 重绑命令执行成功"
else
    fail "frontend 重绑命令执行失败"
fi
EXPECTED="compose --env-file $R/.env.docker -f $R/docker-compose.yml up -d --force-recreate --no-deps frontend"
if [[ "$(cat "$R/docker.log" 2>/dev/null)" == "$EXPECTED" ]]; then
    pass "★ frontend 重绑严格使用 --no-deps，不重启 Brain"
else
    fail "★ frontend 重绑命令不符合隔离契约: $(cat "$R/docker.log" 2>/dev/null)"
fi
rm -rf "$R"

# ── 6) frontend 重绑失败：恢复旧 live，指针不前进 ────────────────────────────
R=$(new_root); D="$R/apps/dashboard"
mkdir -p "$D/dist" "$R/fakebin"; echo "OLD" > "$D/dist/index.html"
printf 'current=prod-cecelia-v0\n' > "$R/.production-release"
stage "$R" "NEW"; run "$R" --release-only
printf '0\n' > "$R/docker-count"
printf '%s\n' '#!/bin/sh' \
    'n=$(cat "$DOCKER_COUNT")' \
    'n=$((n + 1))' \
    'printf "%s\\n" "$n" > "$DOCKER_COUNT"' \
    '[ "$n" -eq 1 ] && exit 1' \
    'exit 0' > "$R/fakebin/docker"
chmod +x "$R/fakebin/docker"
if PATH="$R/fakebin:$PATH" DOCKER_COUNT="$R/docker-count" CECELIA_DEPLOY_ROOT="$R" \
    CECELIA_SKIP_BRAIN_PROMOTE=1 CECELIA_SKIP_HK=1 CECELIA_SKIP_FINGERPRINT=1 \
    bash "$PROMOTE" --deploy prod-cecelia-v1 >/dev/null 2>&1; then
    fail "★ frontend 首次重绑失败却退出 0"
else
    pass "frontend 重绑失败时部署报红"
fi
if [[ "$(cat "$D/dist/index.html" 2>/dev/null)" == "OLD" ]]; then
    pass "★ frontend 重绑失败恢复旧 live dist"
else
    fail "★ frontend 重绑失败未恢复旧 live dist"
fi
if [[ "$(grep '^current=' "$R/.production-release" | head -1)" == "current=prod-cecelia-v0" ]]; then
    pass "★ frontend 重绑失败时生产指针不前进"
else
    fail "★ frontend 重绑失败却推进了生产指针"
fi
rm -rf "$R"

echo ""
echo "=== release-deploy-stage: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]] || exit 1
