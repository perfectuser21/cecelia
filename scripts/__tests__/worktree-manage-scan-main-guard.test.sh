#!/usr/bin/env bash
# worktree-manage-scan-main-guard.test.sh — *-scan-main 目录禁止被当 /dev 会话工作目录
#
# 背景(2026-09-23 P0 事故 9dfd873a)：只读镜像仓库 cecelia-scan-main 曾被某 /dev 会话
# 当成普通 cwd 跑 `worktree-manage.sh create`，导致该仓库被注册了 git worktree、
# 且 .cecelia/hb.sh + .cecelia/lights/*.live 心跳灯写进了 scan-main 自身，
# 让地图照相层扫描器连续 21.5h 拒绝"不干净工作区"。本测试确保守卫在建任何
# 文件/worktree 前就拒绝，且不影响正常仓库。
set -uo pipefail

ERRORS=0
PASS=0
pass() { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS + 1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
MANAGE_SCRIPT="$REPO_ROOT/packages/engine/skills/dev/scripts/worktree-manage.sh"
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/wt-scan-main-guard.XXXXXX")
trap 'rm -rf "$TMPD"' EXIT

make_repo() {
    local dir="$1"
    mkdir -p "$dir"
    ( cd "$dir" && git init -q -b main \
        && git -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m init )
}

if [[ -f "$MANAGE_SCRIPT" ]]; then
    pass "worktree-manage.sh 存在"
else
    fail "找不到 worktree-manage.sh: $MANAGE_SCRIPT"
    echo "结果: PASS=$PASS FAIL=$ERRORS"
    exit 1
fi

echo "=== 单元级：assert_cwd_not_scan_main 判据 ==="

SCAN_MAIN_DIR="$TMPD/cecelia-scan-main"
make_repo "$SCAN_MAIN_DIR"
OUT=$(cd "$SCAN_MAIN_DIR" && bash -c "source '$MANAGE_SCRIPT' 2>/dev/null; assert_cwd_not_scan_main" 2>&1)
RC=$?
if [[ $RC -ne 0 ]]; then
    pass "cecelia-scan-main 目录被 assert_cwd_not_scan_main 拒绝(rc=$RC)"
else
    fail "cecelia-scan-main 目录未被拒绝(rc=$RC)"
fi
if [[ "$OUT" == *"只读镜像仓库"* && "$OUT" == *"scan-main"* ]]; then
    pass "拒绝信息说明是只读镜像仓库且指出路径"
else
    fail "拒绝信息不清晰: $OUT"
fi

NORMAL_DIR="$TMPD/cp-0101010101-some-task"
make_repo "$NORMAL_DIR"
if (cd "$NORMAL_DIR" && bash -c "source '$MANAGE_SCRIPT' 2>/dev/null; assert_cwd_not_scan_main") >/dev/null 2>&1; then
    pass "正常任务目录不受影响"
else
    fail "正常任务目录被误伤拦截"
fi

# 目录名恰好包含但不以 -scan-main 结尾（如 scan-main-archive）不应被拦
ALMOST_DIR="$TMPD/cecelia-scan-main-archive"
make_repo "$ALMOST_DIR"
if (cd "$ALMOST_DIR" && bash -c "source '$MANAGE_SCRIPT' 2>/dev/null; assert_cwd_not_scan_main") >/dev/null 2>&1; then
    pass "非精确后缀(scan-main-archive)不被误伤"
else
    fail "非精确后缀被误伤拦截"
fi

echo ""
echo "=== 端到端：cmd_create 从 scan-main cwd 起会话被整体拒绝 ==="

E2E_SCAN_MAIN_DIR="$TMPD/zenithjoy-scan-main"
make_repo "$E2E_SCAN_MAIN_DIR"
E2E_OUT="$TMPD/e2e-create.out"
E2E_RC=0
( cd "$E2E_SCAN_MAIN_DIR" && bash "$MANAGE_SCRIPT" create some-p0-task ) > "$E2E_OUT" 2>&1 || E2E_RC=$?

if [[ $E2E_RC -ne 0 ]]; then
    pass "cmd_create 从 scan-main cwd 调用以非零退出"
else
    fail "cmd_create 从 scan-main cwd 调用意外成功(rc=$E2E_RC)"
fi

if grep -q '只读镜像仓库' "$E2E_OUT"; then
    pass "cmd_create 拒绝信息命中守卫文案"
else
    fail "cmd_create 未产出守卫拒绝文案: $(cat "$E2E_OUT")"
fi

WT_COUNT=$(git -C "$E2E_SCAN_MAIN_DIR" worktree list 2>/dev/null | wc -l | tr -d ' ')
if [[ "$WT_COUNT" == "1" ]]; then
    pass "拒绝发生在任何 worktree 注册之前（仍只有自身一条）"
else
    fail "scan-main 已被注册了额外 worktree(count=$WT_COUNT)"
fi

if [[ ! -d "$E2E_SCAN_MAIN_DIR/.cecelia" ]]; then
    pass "拒绝发生在心跳灯写入之前（.cecelia/ 未产生）"
else
    fail ".cecelia/ 心跳灯目录仍被写入了"
fi

echo ""
echo "结果: PASS=$PASS FAIL=$ERRORS"
[[ $ERRORS -eq 0 ]] || exit 1
