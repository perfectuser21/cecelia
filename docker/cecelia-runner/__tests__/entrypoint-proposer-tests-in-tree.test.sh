#!/usr/bin/env bash
#
# 回归测试：proposer finalizer 必须校验冻结测试在 push 的 commit 树里（不是只查盘）。
#
# r36（run 40f00669）实证：proposer Provider 自己 commit（RED 写进 repo 既有测试文件，
# sprint tests/ 只留盘上未提交），finalizer 查盘通过 + diff --cached quiet 跳过自身 commit
# → push 出的 propose 树无冻结测试 → reviewer APPROVED 后封印 requireTests 拦截 failRun
# （死得太晚太贵，proposer 无反馈重试机会）。
# 修：push 前 git ls-tree 校验 HEAD 树中 $sprint_dir/tests 非空。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
PASSED=0; FAILED=0
pass() { echo -e "${GREEN}✓${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }

# 静态断言：finalizer 在 push 之前有 ls-tree 校验（接线证明）
PUSH_LINE=$(grep -n 'push origin "HEAD:refs/heads/\$branch"' "$ENTRYPOINT" | head -1 | cut -d: -f1)
TREE_LINE=$(grep -n 'ls-tree.*HEAD.*tests\|ls-tree -r HEAD' "$ENTRYPOINT" | head -1 | cut -d: -f1)
if [[ -n "$TREE_LINE" && -n "$PUSH_LINE" && "$TREE_LINE" -lt "$PUSH_LINE" ]]; then
  pass "finalizer 在 push 前做 HEAD 树 ls-tree 校验 (line $TREE_LINE < push $PUSH_LINE)"
else
  fail "finalizer 缺 push 前 HEAD 树校验 (tree=$TREE_LINE push=$PUSH_LINE)"
fi

# 行为断言：提取校验片段，在真 git repo 里复现 r36 场景
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
R="$TEST_ROOT/repo"
git init -q -b main "$R"
git -C "$R" -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null commit -q --no-verify --allow-empty -m base
SPRINT="sprints/x-kernel-t"
mkdir -p "$R/$SPRINT/tests"
printf '%s' '# 合同' > "$R/$SPRINT/contract-draft.md"
printf '%s' 'RED' > "$R/$SPRINT/tests/a.test.ts"
# r36 场景：Provider 只 commit 文档，tests 留盘上未提交
git -C "$R" -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null add "$SPRINT/contract-draft.md"
git -C "$R" -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null commit -q --no-verify -m "contract only"

tree_has_tests() {
  [[ -n "$(git -C "$R" ls-tree -r HEAD --name-only -- "$SPRINT/tests" 2>/dev/null | head -1)" ]]
}
if tree_has_tests; then
  fail "复现前提错误：树里不应有 tests"
else
  pass "r36 场景复现：盘上有 tests、HEAD 树里没有（此时 finalizer 必须拒）"
fi
git -C "$R" -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null add "$SPRINT/tests"
git -C "$R" -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null commit -q --no-verify -m "tests"
tree_has_tests && pass "tests 入树后校验通过" || fail "tests 入树后仍拒"

echo ""
echo "PASSED: $PASSED FAILED: $FAILED"
[[ $FAILED -eq 0 ]]
