#!/usr/bin/env bash
# lint-test-pairing.sh
# 验证：PR 中新增/修改的 packages/brain/src/**/*.js（非测试）必须配套 *.test.js
# 候选测试位置：同目录 <name>.test.js / __tests__/<name>.test.js / .spec.js 同名
#
# 使用：bash lint-test-pairing.sh [BASE_REF]
# 默认 BASE_REF=origin/main
#
# 退出码：0 = 通过，1 = 失败
set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "🔍 lint-test-pairing — base: $BASE_REF"

# fetch base 以便 diff 在 CI 拿到完整历史
git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

# 新增/修改的 brain src js（排除 __tests__/ 和 *.test.js / *.spec.js）
ADDED_SRC=$(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '^packages/brain/src/.*\.js$' \
  | grep -v '/__tests__/' \
  | grep -vE '\.(test|spec)\.js$' \
  || true)

if [ -z "$ADDED_SRC" ]; then
  echo "⏭️  无新增/修改 brain src js，跳过"
  exit 0
fi

# PR 自身已添加/修改的测试文件（diff 内可见）
PR_TESTS=$(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '\.(test|spec)\.js$|/__tests__/' \
  || true)

MISSING=()
while IFS= read -r src; do
  [ -z "$src" ] && continue
  base=$(basename "$src" .js)
  dir=$(dirname "$src")
  # 候选测试路径
  cand1="${dir}/${base}.test.js"
  cand2="${dir}/__tests__/${base}.test.js"
  cand3="${dir}/${base}.spec.js"

  found=0
  for cand in "$cand1" "$cand2" "$cand3"; do
    # PR diff 内含 OR 仓库已存在
    if echo "$PR_TESTS" | grep -qxF "$cand" || [ -f "$cand" ]; then
      found=1
      break
    fi
  done

  if [ "$found" -eq 0 ]; then
    MISSING+=("$src")
  fi
done <<< "$ADDED_SRC"

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "::error::lint-test-pairing 失败 — 以下 brain src 缺配套 test:"
  for f in "${MISSING[@]}"; do
    base=$(basename "$f" .js)
    dir=$(dirname "$f")
    echo "  ❌ $f"
    echo "     候选: ${dir}/${base}.test.js  或  ${dir}/__tests__/${base}.test.js"
  done
  exit 1
fi

# 内容校验（Tier 1 加牙）：配套 test 文件必须含真断言，不能纯 skip / 空 / 注释
# 防止"建空 test 文件就过 lint"的绕过路径
EMPTY_TESTS=()
SKIPPED_ONLY=()
while IFS= read -r src; do
  [ -z "$src" ] && continue
  base=$(basename "$src" .js)
  dir=$(dirname "$src")
  for cand in "${dir}/${base}.test.js" "${dir}/__tests__/${base}.test.js" "${dir}/${base}.spec.js"; do
    if [ ! -f "$cand" ]; then continue; fi
    # 必须含 ≥1 个 it/test/expect
    if ! grep -qE "(^|[^a-zA-Z])(it|test|expect)\s*\(" "$cand"; then
      EMPTY_TESTS+=("$cand")
      break
    fi
    # 不能 100% 是 skip — 至少 1 个非 skip 的 it/test
    NONSKIP=$(grep -cE "(^|[^a-zA-Z\.])(it|test)\s*\(" "$cand" 2>/dev/null || echo 0)
    SKIPS=$(grep -cE "(it|test|describe)\.skip\s*\(" "$cand" 2>/dev/null || echo 0)
    if [ "$NONSKIP" -gt 0 ] && [ "$SKIPS" -ge "$NONSKIP" ]; then
      SKIPPED_ONLY+=("$cand")
    fi
    break
  done
done <<< "$ADDED_SRC"

if [ "${#EMPTY_TESTS[@]}" -gt 0 ]; then
  echo "::error::lint-test-pairing 失败 — 以下 test 文件无任何 it/test/expect 调用（空架子绕过）:"
  printf "  ❌ %s\n" "${EMPTY_TESTS[@]}"
  exit 1
fi

if [ "${#SKIPPED_ONLY[@]}" -gt 0 ]; then
  echo "::error::lint-test-pairing 失败 — 以下 test 文件 100% skip（it.skip / test.skip / describe.skip）:"
  printf "  ❌ %s\n" "${SKIPPED_ONLY[@]}"
  exit 1
fi

COUNT=$(echo "$ADDED_SRC" | wc -l | tr -d ' ')
echo "✅ lint-test-pairing 通过（${COUNT} 个 src 文件全部配套真 test）"
