#!/usr/bin/env bash
# lint-tdd-commit-order.sh
# 验证：含 packages/brain/src/*.js 改动的 commit 之前必须有 *.test.js commit（TDD 纪律）
#
# 算法：按时间顺序扫描 PR commits（旧→新）
#   - 先看本 commit 是否含 *.test.js / __tests__/ 改动 → 标记 SEEN_TEST=1
#   - 再看本 commit 是否含 brain/src/*.js 改动（非 test）
#     - 若有 src 改动且 SEEN_TEST=0 → 失败（src 跑在 test 前）
#
# 同 commit 内 test + src 共存视为通过（test 先于 src 检查）
#
# 使用：bash lint-tdd-commit-order.sh [BASE_REF]
#
# 退出码：0 = 通过，1 = 失败
set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "🔍 lint-tdd-commit-order — base: $BASE_REF"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

# PR commits（按时间正序）
COMMITS=$(git log --reverse --pretty=%H "${BASE_REF}..HEAD" 2>/dev/null || true)
if [ -z "$COMMITS" ]; then
  echo "⏭️  PR 无新 commit，跳过"
  exit 0
fi

SEEN_TEST=0
FIRST_BAD_SHA=""
FIRST_BAD_FILES=""
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  CHANGED=$(git diff-tree --no-commit-id --name-only -r "$sha" 2>/dev/null || true)

  HAS_TEST=$(echo "$CHANGED" | grep -E '\.(test|spec)\.js$|/__tests__/' || true)
  HAS_SRC=$(echo "$CHANGED" \
    | grep -E '^packages/brain/src/.*\.js$' \
    | grep -vE '\.(test|spec)\.js$|/__tests__/' \
    || true)

  # test 先于 src 检查 — 同 commit 含两者也算 OK
  # 内容校验（Tier 1 加牙）：test commit 不能 100% 是 .skip
  # 防止"加 it.skip(...) 顺序对就过"的绕过路径
  if [ -n "$HAS_TEST" ]; then
    REAL_TEST_FOUND=0
    while IFS= read -r tf; do
      [ -z "$tf" ] && continue
      [ ! -f "$tf" ] && continue
      # 此 commit 加的内容（diff +）必须含至少一个非 skip 的 it/test
      ADDED=$(git show "$sha" -- "$tf" 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+')
      if echo "$ADDED" | grep -qE "(^|[^a-zA-Z\.])(it|test)\s*\("; then
        # 有真 it/test，再看是否被 skip 包围（grep -c 在无匹配时 exit 1，| true 兜底防 set -e）
        ADDED_NONSKIP=$(echo "$ADDED" | grep -cE "(^|[^a-zA-Z\.])(it|test)\s*\(" || true)
        ADDED_SKIPS=$(echo "$ADDED" | grep -cE "(it|test|describe)\.skip\s*\(" || true)
        ADDED_NONSKIP="${ADDED_NONSKIP:-0}"
        ADDED_SKIPS="${ADDED_SKIPS:-0}"
        if [ "$ADDED_NONSKIP" -gt 0 ] && [ "$ADDED_SKIPS" -lt "$ADDED_NONSKIP" ]; then
          REAL_TEST_FOUND=1
          break
        fi
      fi
    done <<< "$HAS_TEST"
    if [ "$REAL_TEST_FOUND" -eq 1 ]; then
      SEEN_TEST=1
    else
      echo "  [info] commit $sha 含 test 文件但全是 skip 或无 it/test 调用，不计入 SEEN_TEST"
    fi
  fi

  if [ -n "$HAS_SRC" ] && [ "$SEEN_TEST" -eq 0 ]; then
    FIRST_BAD_SHA="$sha"
    FIRST_BAD_FILES="$HAS_SRC"
    break
  fi
done <<< "$COMMITS"

if [ -n "$FIRST_BAD_SHA" ]; then
  echo "::error::lint-tdd-commit-order 失败 — TDD 纪律违反"
  echo "  commit $FIRST_BAD_SHA 含 brain/src/*.js 改动，但此前 PR 系列无 *.test.js commit"
  echo "  违反 Superpowers TDD iron law: NO PRODUCTION CODE WITHOUT FAILING TEST FIRST"
  echo ""
  echo "  src 文件:"
  echo "$FIRST_BAD_FILES" | sed 's/^/    /'
  echo ""
  echo "  修复："
  echo "    git rebase -i ${BASE_REF}  # 调整 commit 顺序，让 fail-test commit 在前"
  echo ""
  echo "  PR commit 历史："
  git log --oneline "${BASE_REF}..HEAD"
  exit 1
fi

echo "✅ lint-tdd-commit-order 通过"
