#!/usr/bin/env bash
#
# 回归测试：entrypoint.sh import_contract_artifacts_precommit
#
# r30（run ee2f9ff9 attempt 0a2c004e）结构根因：合同文档随 (Red) 一起 commit → TDD 闸红，
# 重排历史 → 血统闸 fail-closed 死锁。修法（fix 自己陈词方案 b）：Runner 物化合同产物后、
# Provider 开跑前预提交 `chore(harness): import contract`，(Red) 天然纯净。
#
# 测试策略：从 entrypoint.sh 原文提取函数体，在真 git repo 沙箱执行（真零件）。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
PASSED=0; FAILED=0
pass() { echo -e "${GREEN}✓${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }

FN_SRC="$(awk '/^import_contract_artifacts_precommit\(\) \{$/,/^\}$/' "$ENTRYPOINT")"
if [[ -z "$FN_SRC" ]]; then
  fail "entrypoint.sh 必须定义 import_contract_artifacts_precommit()"
  echo "FAILED: $FAILED"
  exit 1
fi

WORKSPACE="$TEST_ROOT/workspace"
BUNDLE="$TEST_ROOT/bundle.json"
SPRINT='sprints/example'
mkdir -p "$WORKSPACE"
git -C "$WORKSPACE" init -q -b cp-test
git -C "$WORKSPACE" -c core.hooksPath=/dev/null -c user.name=t -c user.email=t@t commit -q --no-verify --allow-empty -m base

# 物化产物（文档 + tests）为 untracked 文件 + 一个无关杂物
mkdir -p "$WORKSPACE/$SPRINT/tests"
printf '%s' '# 合同' > "$WORKSPACE/$SPRINT/contract-draft.md"
printf '%s' '# DoD' > "$WORKSPACE/$SPRINT/contract-dod.md"
printf '%s' '# PRD' > "$WORKSPACE/$SPRINT/sprint-prd.md"
printf '%s' 'throw new Error("RED");' > "$WORKSPACE/$SPRINT/tests/red.test.ts"
printf '%s' 'junk' > "$WORKSPACE/junk.txt"

jq -n --arg s "$SPRINT" '{task_bundle:{role:"generator",inputs:{
  artifacts:[{path:($s+"/tests/red.test.ts")}],
  contract_artifacts:[
    {path:($s+"/contract-draft.md")},
    {path:($s+"/contract-dod.md")},
    {path:($s+"/sprint-prd.md")}
  ]}}}' > "$BUNDLE"

run_fn() {
  bash -c "set -uo pipefail
$FN_SRC
import_contract_artifacts_precommit \"\$1\"" bash "$BUNDLE"
}

BEFORE="$(git -C "$WORKSPACE" rev-parse HEAD)"
if (cd "$WORKSPACE" && WORKTREE_PATH="$WORKSPACE" run_fn); then
  pass "预提交执行成功"
else
  fail "预提交执行失败"
fi

AFTER="$(git -C "$WORKSPACE" rev-parse HEAD)"
[[ "$AFTER" != "$BEFORE" ]] && pass "HEAD 前进" || fail "HEAD 未前进"

MSG="$(git -C "$WORKSPACE" log -1 --format=%s)"
[[ "$MSG" == 'chore(harness): import contract' ]] \
  && pass "commit message 精确匹配" || fail "commit message 不符: $MSG"

if git -C "$WORKSPACE" status --porcelain --untracked-files=all | grep -q "^?? $SPRINT/"; then
  fail "合同产物仍有 untracked"
else
  pass "合同产物全部 tracked（Red 纯净前提）"
fi

git -C "$WORKSPACE" status --porcelain --untracked-files=all | grep -q '^?? junk.txt' \
  && pass "无关杂物不被卷入" || fail "junk.txt 被误提交"

# 幂等：第二次调用不产生新 commit
if (cd "$WORKSPACE" && WORKTREE_PATH="$WORKSPACE" run_fn); then
  pass "重入调用成功（幂等出口）"
else
  fail "重入调用失败"
fi
[[ "$(git -C "$WORKSPACE" rev-parse HEAD)" == "$AFTER" ]] \
  && pass "幂等：无新 commit" || fail "重入产生了新 commit"

# 接线断言：调用点位于血统闸安装之后、Provider 身份隔离之前，且 generator-only
CALL_LINE="$(grep -n 'import_contract_artifacts_precommit "\$task_bundle_file"' "$ENTRYPOINT" | head -1 | cut -d: -f1 || true)"
GUARD_LINE="$(grep -n 'if ! install_frozen_baseline_guard' "$ENTRYPOINT" | head -1 | cut -d: -f1)"
IDENTITY_LINE="$(grep -n 'if ! prepare_evaluator_provider_identity' "$ENTRYPOINT" | head -1 | cut -d: -f1)"
if [[ -n "$CALL_LINE" && "$CALL_LINE" -gt "$GUARD_LINE" && "$CALL_LINE" -lt "$IDENTITY_LINE" ]]; then
  pass "调用点在血统闸之后、身份隔离之前（HEAD==START_SHA 断言不被破坏）"
else
  fail "调用点接线错误 (call=$CALL_LINE guard=$GUARD_LINE identity=$IDENTITY_LINE)"
fi
sed -n "${CALL_LINE:-0}p" "$ENTRYPOINT" | grep -q 'is_generator_task_bundle' \
  && pass "调用点 generator-only 守卫" || fail "调用点缺 is_generator_task_bundle 守卫"

echo ""
echo "PASSED: $PASSED  FAILED: $FAILED"
[[ $FAILED -eq 0 ]]
